import {
  Injectable, Logger, ForbiddenException, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrthancService } from '../orthanc/orthanc.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../auth/current-user.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { paginate, skipTake } from '../common/pagination';
import * as net from 'net';

/**
 * DICOM Reverse Push (PACS Operations Module 1).
 *
 * Transfer engine = Orthanc native C-STORE SCU (no extra service). For each job
 * we register the destination as an Orthanc modality, issue an async
 * /modalities/{id}/store, and poll Orthanc's job for REAL acknowledgment. A job
 * is COMPLETED only when Orthanc reports the store job succeeded.
 *
 * SSRF protection: destinations are admin-configured (allow-list). We validate
 * host/port and refuse obviously-internal infra targets (postgres/redis/backend).
 */
@Injectable()
export class ReversePushService {
  private readonly log = new Logger('ReversePushService');
  private running = false; // single-flight guard for the tick (plus Redis lock in scheduler)

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private orthanc: OrthancService,
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {}

  private can(user: AuthUser, perm: string) { return user.isSuperAdmin || user.permissions.includes(perm); }
  private require(user: AuthUser, perm: string) { if (!this.can(user, perm)) throw new ForbiddenException(`Missing permission: ${perm}`); }
  private orgScope(user: AuthUser) { return user.isSuperAdmin ? {} : { organizationId: user.organizationId ?? '__none__' }; }
  private assertOrg(user: AuthUser, orgId?: string | null) {
    if (user.isSuperAdmin) return;
    if (!orgId || orgId !== user.organizationId) throw new ForbiddenException('Resource belongs to another organization');
  }

  // ───────────────────────── destinations ─────────────────────────

  /** SSRF / safety guard for a destination host. Admin-only config, but still validated. */
  private validateHost(host: string, port: number) {
    if (!host || !/^[a-zA-Z0-9.\-_]+$/.test(host)) throw new BadRequestException('Invalid destination host');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BadRequestException('Invalid destination port');
    // Refuse pushing to our own internal infra service names (defense in depth).
    const blocked = ['postgres', 'redis', 'backend', 'nginx', 'localhost', '127.0.0.1', '::1'];
    if (blocked.includes(host.toLowerCase())) throw new BadRequestException('Destination host is not allowed');
  }

  async listDestinations(user: AuthUser, q: any) {
    this.require(user, PERMISSIONS.PACS_REVERSE_PUSH_VIEW);
    const where: any = { ...this.orgScope(user) };
    if (q.active !== undefined) where.active = q.active === 'true';
    const [data, total] = await this.prisma.$transaction([
      this.prisma.pacsDestination.findMany({ where, orderBy: { name: 'asc' }, ...skipTake(q) }),
      this.prisma.pacsDestination.count({ where }),
    ]);
    return paginate(data, total, q);
  }

  async getDestination(user: AuthUser, id: string) {
    this.require(user, PERMISSIONS.PACS_REVERSE_PUSH_VIEW);
    const d = await this.prisma.pacsDestination.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Destination not found');
    this.assertOrg(user, d.organizationId);
    return d;
  }

  async createDestination(user: AuthUser, dto: any, ip?: string) {
    this.require(user, PERMISSIONS.PACS_DESTINATION_MANAGE);
    this.validateHost(dto.host, dto.port);
    const organizationId = user.isSuperAdmin ? (dto.organizationId ?? null) : (user.organizationId ?? null);
    const d = await this.prisma.pacsDestination.create({
      data: {
        organizationId, name: dto.name, aeTitle: dto.aeTitle, host: dto.host, port: dto.port,
        callingAet: dto.callingAet ?? 'GGHPACS',
        connectionTimeout: dto.connectionTimeout ?? 10, associationTimeout: dto.associationTimeout ?? 30,
        maxConcurrent: dto.maxConcurrent ?? 1, active: dto.active ?? true, description: dto.description,
      },
    });
    await this.audit.log({ userId: user.id, action: 'PACS_DESTINATION_CREATE', entityType: 'PacsDestination', entityId: d.id, detail: { name: d.name, aeTitle: d.aeTitle }, ip });
    return d;
  }

  async updateDestination(user: AuthUser, id: string, dto: any, ip?: string) {
    this.require(user, PERMISSIONS.PACS_DESTINATION_MANAGE);
    await this.getDestination(user, id);
    if (dto.host || dto.port) this.validateHost(dto.host ?? 'x', dto.port ?? 104);
    const data: any = {};
    for (const k of ['name', 'aeTitle', 'host', 'port', 'callingAet', 'connectionTimeout', 'associationTimeout', 'maxConcurrent', 'active', 'description'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    const d = await this.prisma.pacsDestination.update({ where: { id }, data });
    await this.audit.log({ userId: user.id, action: 'PACS_DESTINATION_UPDATE', entityType: 'PacsDestination', entityId: id, ip });
    return d;
  }

  /** Test connection via a real DICOM C-ECHO (Orthanc native SCU). */
  async testDestination(user: AuthUser, id: string, ip?: string) {
    this.require(user, PERMISSIONS.PACS_DESTINATION_MANAGE);
    const d = await this.getDestination(user, id);
    this.validateHost(d.host, d.port);
    // First a quick TCP reachability probe (fast failure), then Orthanc C-ECHO.
    const tcp = await this.tcpProbe(d.host, d.port, (d.connectionTimeout ?? 10) * 1000);
    let result: { ok: boolean; detail?: string };
    if (!tcp) {
      result = { ok: false, detail: `TCP connect to ${d.host}:${d.port} failed` };
    } else {
      const modId = `revpush_${d.id.slice(0, 8)}`;
      await this.orthanc.putModality(modId, d.aeTitle, d.host, d.port);
      result = await this.orthanc.echoModality(modId);
      await this.orthanc.deleteModality(modId);
    }
    await this.prisma.pacsDestination.update({
      where: { id }, data: { lastTestAt: new Date(), lastTestStatus: result.ok ? 'SUCCESS' : 'FAILED', lastTestDetail: result.detail ?? (result.ok ? 'C-ECHO OK' : 'failed') },
    });
    await this.audit.log({ userId: user.id, action: 'PACS_DESTINATION_TEST', status: result.ok ? 'SUCCESS' : 'FAILURE', entityType: 'PacsDestination', entityId: id, detail: { ok: result.ok }, ip });
    return { ok: result.ok, detail: result.detail ?? (result.ok ? 'C-ECHO acknowledged' : 'C-ECHO failed') };
  }

  private tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = new net.Socket(); let done = false;
      const fin = (ok: boolean) => { if (!done) { done = true; sock.destroy(); resolve(ok); } };
      sock.setTimeout(timeoutMs);
      sock.once('connect', () => fin(true));
      sock.once('timeout', () => fin(false));
      sock.once('error', () => fin(false));
      sock.connect(port, host);
    });
  }

  // ───────────────────────── jobs ─────────────────────────

  async createJob(user: AuthUser, dto: { destinationId: string; studyInstanceUid: string }, ip?: string) {
    this.require(user, PERMISSIONS.PACS_REVERSE_PUSH_MANAGE);
    const dest = await this.getDestination(user, dto.destinationId);
    if (!dest.active) throw new BadRequestException('Destination is inactive');

    // Resolve the study: must belong to the user's org (org isolation).
    const study = await this.prisma.study.findUnique({ where: { studyInstanceUid: dto.studyInstanceUid } });
    if (!study) throw new NotFoundException('Study not found');
    this.assertOrg(user, study.organizationId);
    if (!study.orthancStudyId) throw new BadRequestException('Study has no images in Orthanc');

    // Idempotency: one active job per (destination, study). We match on the
    // concrete destination + study + active status (not the stored dedupKey,
    // which carries a creation timestamp to stay globally unique).
    const existingActive = await this.prisma.dicomTransferJob.findFirst({
      where: {
        destinationId: dest.id,
        studyInstanceUid: study.studyInstanceUid,
        status: { in: ['PENDING', 'QUEUED', 'RUNNING'] },
      },
    });
    if (existingActive) throw new ConflictException('An active transfer job already exists for this study + destination');

    // Enumerate instances up front (instance-level tracking).
    const details = await this.orthanc.getStudyInstanceDetails(study.orthancStudyId);

    const job = await this.prisma.$transaction(async (tx) => {
      const j = await tx.dicomTransferJob.create({
        data: {
          organizationId: study.organizationId, destinationId: dest.id,
          studyId: study.id, studyInstanceUid: study.studyInstanceUid, orthancStudyId: study.orthancStudyId,
          status: 'QUEUED', totalInstances: details.length, pendingInstances: details.length,
          // globally-unique key (its own constraint); active-dup is enforced by the
          // destination+study+status check above, not by this key.
          dedupKey: `revpush:${dest.id}:${study.studyInstanceUid}:${Date.now()}`,
          createdBy: user.id,
        },
      });
      if (details.length) {
        await tx.dicomTransferInstance.createMany({
          data: details.map((d) => ({ jobId: j.id, sopInstanceUid: d.sopInstanceUid, orthancInstanceId: d.orthancId, status: 'PENDING' })),
        });
      }
      return j;
    });
    await this.audit.log({ userId: user.id, action: 'PACS_REVERSE_PUSH_CREATE', entityType: 'DicomTransferJob', entityId: job.id, detail: { destination: dest.name, studyInstanceUid: study.studyInstanceUid, instances: details.length }, ip });
    return job;
  }

  async listJobs(user: AuthUser, q: any) {
    this.require(user, PERMISSIONS.PACS_REVERSE_PUSH_VIEW);
    const where: any = { ...this.orgScope(user) };
    if (q.status) where.status = q.status;
    if (q.destinationId) where.destinationId = q.destinationId;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.dicomTransferJob.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q), include: { destination: { select: { name: true, aeTitle: true } } } }),
      this.prisma.dicomTransferJob.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  async getJob(user: AuthUser, id: string) {
    this.require(user, PERMISSIONS.PACS_REVERSE_PUSH_VIEW);
    const job = await this.prisma.dicomTransferJob.findUnique({
      where: { id },
      include: { destination: true, instances: { orderBy: { sopInstanceUid: 'asc' }, take: 500 } },
    });
    if (!job) throw new NotFoundException('Job not found');
    this.assertOrg(user, job.organizationId);
    return job;
  }

  private async transition(user: AuthUser, id: string, action: string, apply: (job: any) => Promise<any>) {
    this.require(user, PERMISSIONS.PACS_REVERSE_PUSH_MANAGE);
    const job = await this.prisma.dicomTransferJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    this.assertOrg(user, job.organizationId);
    const r = await apply(job);
    await this.audit.log({ userId: user.id, action, entityType: 'DicomTransferJob', entityId: id });
    return r;
  }

  pauseJob(user: AuthUser, id: string) {
    return this.transition(user, id, 'PACS_REVERSE_PUSH_PAUSE', async (job) => {
      if (!['QUEUED', 'RUNNING', 'PENDING'].includes(job.status)) throw new ConflictException(`Cannot pause a ${job.status} job`);
      return this.prisma.dicomTransferJob.update({ where: { id }, data: { status: 'PENDING', pausedAt: new Date() } });
    });
  }

  resumeJob(user: AuthUser, id: string) {
    return this.transition(user, id, 'PACS_REVERSE_PUSH_RESUME', async (job) => {
      if (job.status !== 'PENDING') throw new ConflictException(`Cannot resume a ${job.status} job`);
      return this.prisma.dicomTransferJob.update({ where: { id }, data: { status: 'QUEUED', pausedAt: null } });
    });
  }

  cancelJob(user: AuthUser, id: string) {
    return this.transition(user, id, 'PACS_REVERSE_PUSH_CANCEL', async (job) => {
      if (['COMPLETED', 'CANCELLED'].includes(job.status)) throw new ConflictException(`Cannot cancel a ${job.status} job`);
      // Set a cancel flag; the executor releases the Orthanc job safely on next tick.
      return this.prisma.dicomTransferJob.update({ where: { id }, data: { cancelRequested: true, status: 'CANCELLED', completedAt: new Date() } });
    });
  }

  retryJob(user: AuthUser, id: string) {
    return this.transition(user, id, 'PACS_REVERSE_PUSH_RETRY', async (job) => {
      if (!['FAILED', 'PARTIALLY_COMPLETED'].includes(job.status)) throw new ConflictException(`Only FAILED/PARTIALLY_COMPLETED jobs can be retried (current: ${job.status})`);
      // Reset failed instances to PENDING and re-queue.
      await this.prisma.dicomTransferInstance.updateMany({ where: { jobId: id, status: 'FAILED' }, data: { status: 'PENDING', error: null } });
      const pending = await this.prisma.dicomTransferInstance.count({ where: { jobId: id, status: 'PENDING' } });
      return this.prisma.dicomTransferJob.update({
        where: { id },
        data: { status: 'QUEUED', retryCount: { increment: 1 }, failedInstances: 0, pendingInstances: pending, lastError: null, cancelRequested: false, completedAt: null },
      });
    });
  }

  // ───────────────────────── executor (called by scheduler) ─────────────────────────

  /**
   * Execute one queued job. Called by the ops scheduler under a Redis lock.
   * Uses Orthanc's native async store job and polls it for real acknowledgment.
   * Returns true if it processed a job (so the scheduler can loop).
   */
  async runNextQueuedJob(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      // Recovery (reliability): reconcile any job left RUNNING by a backend restart
      // against its real Orthanc store-job state before starting new work.
      await this.recoverStuckJobs();
      const job = await this.prisma.dicomTransferJob.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
      if (!job) return false;
      await this.executeJob(job.id);
      return true;
    } catch (e: any) {
      this.log.error(`runNextQueuedJob failed: ${e?.message}`);
      return false;
    } finally {
      this.running = false;
    }
  }

  /** Reconcile RUNNING jobs whose executor was interrupted (e.g. backend restart)
   * by reading their Orthanc store-job state and finalizing accordingly. */
  private async recoverStuckJobs() {
    const stuck = await this.prisma.dicomTransferJob.findMany({
      where: { status: 'RUNNING', orthancJobId: { not: null } },
      select: { id: true, orthancJobId: true, startedAt: true },
    });
    for (const j of stuck) {
      try {
        const ort = await this.orthanc.getJob(j.orthancJobId!);
        if (!ort) continue;
        if (ort.State === 'Success') {
          await this.prisma.dicomTransferInstance.updateMany({ where: { jobId: j.id, status: 'PENDING' }, data: { status: 'SUCCESS', sentAt: new Date() } });
          await this.finalize(j.id, (j.startedAt ?? new Date()).getTime(), 'Success');
        } else if (ort.State === 'Failure') {
          await this.prisma.dicomTransferInstance.updateMany({ where: { jobId: j.id, status: 'PENDING' }, data: { status: 'FAILED', error: 'Orthanc store Failure' } });
          await this.finalize(j.id, (j.startedAt ?? new Date()).getTime(), 'Failure');
        }
        // if still Pending/Running on Orthanc, leave it — a live executor is polling it.
      } catch (e: any) {
        this.log.warn(`recoverStuckJobs ${j.id}: ${e?.message}`);
      }
    }
  }

  private async executeJob(jobId: string) {
    const job = await this.prisma.dicomTransferJob.findUnique({ where: { id: jobId }, include: { destination: true } });
    if (!job || job.status !== 'QUEUED') return;
    if (job.cancelRequested) { await this.prisma.dicomTransferJob.update({ where: { id: jobId }, data: { status: 'CANCELLED', completedAt: new Date() } }); return; }
    const dest = job.destination;

    const start = Date.now();
    await this.prisma.dicomTransferJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } });

    const modId = `revpush_${dest.id.slice(0, 8)}`;
    try {
      await this.orthanc.putModality(modId, dest.aeTitle, dest.host, dest.port);

      // Send only the still-pending instances (supports retry of failed subset).
      const pendingInstances = await this.prisma.dicomTransferInstance.findMany({ where: { jobId, status: 'PENDING' }, select: { orthancInstanceId: true } });
      const resources = pendingInstances.map((i) => i.orthancInstanceId!).filter(Boolean);
      if (resources.length === 0) { await this.finalize(jobId, start); return; }

      const { jobId: orthancJobId } = await this.orthanc.storeToModality(modId, resources);
      await this.prisma.dicomTransferJob.update({ where: { id: jobId }, data: { orthancJobId } });

      // Poll the Orthanc store job until it finishes (or job is cancelled).
      let ortJob: any; let tries = 0;
      do {
        await new Promise((r) => setTimeout(r, 1000));
        const fresh = await this.prisma.dicomTransferJob.findUnique({ where: { id: jobId }, select: { cancelRequested: true } });
        if (fresh?.cancelRequested) { await this.prisma.dicomTransferJob.update({ where: { id: jobId }, data: { status: 'CANCELLED', completedAt: new Date() } }); await this.orthanc.deleteModality(modId); return; }
        ortJob = await this.orthanc.getJob(orthancJobId);
        tries++;
      } while (ortJob && ['Pending', 'Running', 'Paused'].includes(ortJob.State) && tries < 600);

      // Orthanc reports real success/failure counts for the store job.
      const succeeded = ortJob?.Content?.InstancesCount ?? ortJob?.Content?.SuccessCount ?? (ortJob?.State === 'Success' ? resources.length : 0);
      const failed = ortJob?.Content?.FailedInstancesCount ?? (ortJob?.State === 'Failure' ? resources.length : 0);

      // Mark instances per Orthanc's outcome. Orthanc store is all-or-per-instance;
      // if the job succeeded we mark all sent instances SUCCESS, else FAILED.
      if (ortJob?.State === 'Success') {
        await this.prisma.dicomTransferInstance.updateMany({ where: { jobId, status: 'PENDING' }, data: { status: 'SUCCESS', sentAt: new Date() } });
      } else {
        await this.prisma.dicomTransferInstance.updateMany({ where: { jobId, status: 'PENDING' }, data: { status: 'FAILED', error: `Orthanc store ${ortJob?.State ?? 'unknown'}` } });
      }
      await this.orthanc.deleteModality(modId);
      await this.finalize(jobId, start, ortJob?.State, succeeded, failed);
    } catch (e: any) {
      await this.orthanc.deleteModality(modId);
      await this.prisma.dicomTransferInstance.updateMany({ where: { jobId, status: 'PENDING' }, data: { status: 'FAILED', error: String(e?.message).slice(0, 300) } });
      await this.finalize(jobId, start, 'Failure');
      this.log.error(`executeJob ${jobId} failed: ${e?.message}`);
    }
  }

  /** Recompute counts + final status from instance rows (source of truth). */
  private async finalize(jobId: string, startMs: number, orthancState?: string, _succ?: number, _fail?: number) {
    const [total, success, failed] = await Promise.all([
      this.prisma.dicomTransferInstance.count({ where: { jobId } }),
      this.prisma.dicomTransferInstance.count({ where: { jobId, status: 'SUCCESS' } }),
      this.prisma.dicomTransferInstance.count({ where: { jobId, status: 'FAILED' } }),
    ]);
    const pending = total - success - failed;
    let status: string;
    if (success === total && total > 0) status = 'COMPLETED';
    else if (success > 0 && failed > 0) status = 'PARTIALLY_COMPLETED';
    else if (success > 0 && pending === 0) status = 'PARTIALLY_COMPLETED';
    else status = 'FAILED';

    const durationS = (Date.now() - startMs) / 1000;
    const job = await this.prisma.dicomTransferJob.update({
      where: { id: jobId },
      data: {
        status, successInstances: success, failedInstances: failed, pendingInstances: pending,
        completedAt: new Date(),
        transferSpeedKbps: durationS > 0 ? Number(((success * 256) / durationS).toFixed(1)) : null, // rough: ~256KB/instance estimate
        lastError: status === 'FAILED' ? `store ${orthancState ?? 'failed'}` : null,
      },
      include: { destination: { select: { name: true } } },
    });

    // Notify + audit on completion.
    await this.notifications.create({
      category: 'SYSTEM_ALERT', priority: status === 'COMPLETED' ? 'NORMAL' : 'HIGH',
      roleKey: 'pacs_admin', organizationId: job.organizationId, studyId: job.studyId ?? undefined,
      dedupKey: `revpush-done:${jobId}`,
      title: `Reverse push ${status.toLowerCase()}`,
      body: `Study → ${job.destination?.name}: ${success}/${total} instances sent.`,
      link: '/pacs/reverse-push',
    });
    await this.audit.log({ userId: job.createdBy, action: 'PACS_REVERSE_PUSH_DONE', status: status === 'COMPLETED' ? 'SUCCESS' : 'FAILURE', entityType: 'DicomTransferJob', entityId: jobId, detail: { status, success, failed, total } });
  }

  // ───────────────────────── monitor dashboard ─────────────────────────

  async monitor(user: AuthUser) {
    this.require(user, PERMISSIONS.PACS_REVERSE_PUSH_VIEW);
    const scope = this.orgScope(user);
    const [pending, queued, running, completed, partial, failed, cancelled, dests] = await this.prisma.$transaction([
      this.prisma.dicomTransferJob.count({ where: { ...scope, status: 'PENDING' } }),
      this.prisma.dicomTransferJob.count({ where: { ...scope, status: 'QUEUED' } }),
      this.prisma.dicomTransferJob.count({ where: { ...scope, status: 'RUNNING' } }),
      this.prisma.dicomTransferJob.count({ where: { ...scope, status: 'COMPLETED' } }),
      this.prisma.dicomTransferJob.count({ where: { ...scope, status: 'PARTIALLY_COMPLETED' } }),
      this.prisma.dicomTransferJob.count({ where: { ...scope, status: 'FAILED' } }),
      this.prisma.dicomTransferJob.count({ where: { ...scope, status: 'CANCELLED' } }),
      this.prisma.pacsDestination.findMany({ where: scope, select: { id: true, name: true, aeTitle: true, host: true, port: true, active: true, lastTestAt: true, lastTestStatus: true } }),
    ]);
    const agg = await this.prisma.dicomTransferJob.aggregate({ where: scope, _sum: { totalInstances: true, successInstances: true, failedInstances: true } });
    const totalFiles = agg._sum.totalInstances ?? 0;
    const successFiles = agg._sum.successInstances ?? 0;
    return {
      engine: 'Orthanc native C-STORE SCU',
      queue: { pending, queued, active: running, completed, partiallyCompleted: partial, failed, cancelled },
      transmission: {
        totalFiles, successFiles, failedFiles: agg._sum.failedInstances ?? 0,
        successPercent: totalFiles ? Number(((successFiles / totalFiles) * 100).toFixed(1)) : 0,
      },
      destinations: dests,
      generatedAt: new Date().toISOString(),
    };
  }
}
