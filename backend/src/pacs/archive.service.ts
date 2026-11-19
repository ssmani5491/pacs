import { Injectable, Logger, ForbiddenException, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrthancService } from '../orthanc/orthanc.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../auth/current-user.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { paginate, skipTake } from '../common/pagination';
import { Worker } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';

/**
 * Archive Compression Management (PACS Operations Module 2).
 *
 * COPY-ONLY: pulls a study's DICOM as Orthanc's native (lossless) ZIP, gzip-wraps
 * it at a configurable level in a worker thread, checksums it (SHA-256), and
 * stores a `.zip.gz` file on the archive volume. Original Orthanc instances/files
 * are NEVER deleted or modified; DICOM transfer syntax is never changed.
 *
 * Integrity: verify() re-hashes the stored file and extracts it (gunzip + unzip
 * entry count) to confirm it is readable. An existing VERIFIED archive is never
 * overwritten.
 */
@Injectable()
export class ArchiveService {
  private readonly log = new Logger('ArchiveService');
  private running = false;
  private readonly root: string;
  private readonly defaultWorkers: number;
  private orthancAuth: string;
  private orthancBase: string;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private orthanc: OrthancService,
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {
    this.root = this.config.get<string>('ARCHIVE_ROOT') ?? '/var/lib/pacs/archive';
    this.defaultWorkers = Number(this.config.get('ARCHIVE_WORKERS') ?? 2);
    const user = config.get<string>('ORTHANC_USERNAME') ?? 'orthanc';
    const pass = config.get<string>('ORTHANC_PASSWORD') ?? '';
    this.orthancAuth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    this.orthancBase = (config.get<string>('ORTHANC_URL') ?? 'http://orthanc:8042').replace(/\/$/, '');
    try { fs.mkdirSync(this.root, { recursive: true }); } catch { /* ignore */ }
  }

  private can(user: AuthUser, perm: string) { return user.isSuperAdmin || user.permissions.includes(perm); }
  private require(user: AuthUser, perm: string) { if (!this.can(user, perm)) throw new ForbiddenException(`Missing permission: ${perm}`); }
  private orgScope(user: AuthUser) { return user.isSuperAdmin ? {} : { organizationId: user.organizationId ?? '__none__' }; }
  private assertOrg(user: AuthUser, orgId?: string | null) {
    if (user.isSuperAdmin) return;
    if (!orgId || orgId !== user.organizationId) throw new ForbiddenException('Resource belongs to another organization');
  }

  // ───────────────────────── storage config ─────────────────────────

  async getConfig(user: AuthUser) {
    this.require(user, PERMISSIONS.PACS_ARCHIVE_VIEW);
    const row = await this.prisma.systemSetting.findUnique({ where: { key: 'archive.config' } });
    const cfg = (row?.value as any) ?? {};
    // disk usage of the archive root
    let used = 0;
    try { for (const f of this.walk(this.root)) used += fs.statSync(f).size; } catch { /* ignore */ }
    return {
      source: cfg.source ?? 'orthanc',
      destinationRoot: this.root,
      defaultCompressionLevel: cfg.compressionLevel ?? 6,
      workerThreads: cfg.workerThreads ?? this.defaultWorkers,
      archiveBytesUsed: used,
    };
  }

  async setConfig(user: AuthUser, dto: any, ip?: string) {
    this.require(user, PERMISSIONS.PACS_ARCHIVE_MANAGE);
    const value = {
      source: 'orthanc',
      compressionLevel: Math.max(0, Math.min(9, Number(dto.compressionLevel ?? 6))),
      workerThreads: Math.max(1, Math.min(8, Number(dto.workerThreads ?? this.defaultWorkers))),
    };
    await this.prisma.systemSetting.upsert({ where: { key: 'archive.config' }, update: { value }, create: { key: 'archive.config', value } });
    await this.audit.log({ userId: user.id, action: 'ARCHIVE_CONFIG_UPDATE', detail: value, ip });
    return this.getConfig(user);
  }

  // ───────────────────────── jobs ─────────────────────────

  async createJob(user: AuthUser, dto: { studyInstanceUid: string; compressionLevel?: number }, ip?: string) {
    this.require(user, PERMISSIONS.PACS_ARCHIVE_MANAGE);
    const study = await this.prisma.study.findUnique({ where: { studyInstanceUid: dto.studyInstanceUid } });
    if (!study) throw new NotFoundException('Study not found');
    this.assertOrg(user, study.organizationId);
    if (!study.orthancStudyId) throw new BadRequestException('Study has no images in Orthanc');

    // One active archive job per study at a time (idempotency).
    const active = await this.prisma.archiveJob.findFirst({
      where: { studyInstanceUid: study.studyInstanceUid, status: { in: ['PENDING', 'QUEUED', 'RUNNING'] } },
    });
    if (active) throw new ConflictException('An active archive job already exists for this study');

    const cfg = await this.getConfig(user);
    const level = dto.compressionLevel !== undefined ? Math.max(0, Math.min(9, Number(dto.compressionLevel))) : cfg.defaultCompressionLevel;

    const job = await this.prisma.archiveJob.create({
      data: {
        organizationId: study.organizationId, studyId: study.id,
        studyInstanceUid: study.studyInstanceUid, orthancStudyId: study.orthancStudyId,
        status: 'QUEUED', compressionLevel: level, workerCount: cfg.workerThreads,
        instanceCount: study.imageCount ?? 0,
        dedupKey: `archive:${study.studyInstanceUid}:${Date.now()}`, createdBy: user.id,
      },
    });
    await this.audit.log({ userId: user.id, action: 'ARCHIVE_JOB_CREATE', entityType: 'ArchiveJob', entityId: job.id, detail: { studyInstanceUid: study.studyInstanceUid, level }, ip });
    return job;
  }

  async listJobs(user: AuthUser, q: any) {
    this.require(user, PERMISSIONS.PACS_ARCHIVE_VIEW);
    const where: any = { ...this.orgScope(user) };
    if (q.status) where.status = q.status;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.archiveJob.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.archiveJob.count({ where }),
    ]);
    // BigInt -> string for JSON safety
    return paginate(rows.map((r) => this.serialize(r)), total, q);
  }

  async getJob(user: AuthUser, id: string) {
    this.require(user, PERMISSIONS.PACS_ARCHIVE_VIEW);
    const job = await this.prisma.archiveJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Archive job not found');
    this.assertOrg(user, job.organizationId);
    return this.serialize(job);
  }

  async cancelJob(user: AuthUser, id: string, ip?: string) {
    this.require(user, PERMISSIONS.PACS_ARCHIVE_MANAGE);
    const job = await this.prisma.archiveJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Archive job not found');
    this.assertOrg(user, job.organizationId);
    if (['COMPLETED', 'VERIFIED', 'CANCELLED'].includes(job.status)) throw new ConflictException(`Cannot cancel a ${job.status} job`);
    const r = await this.prisma.archiveJob.update({ where: { id }, data: { cancelRequested: true, status: 'CANCELLED', completedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'ARCHIVE_JOB_CANCEL', entityType: 'ArchiveJob', entityId: id, ip });
    return this.serialize(r);
  }

  /** Verify a completed archive: re-hash + extract (gunzip + unzip entry count). */
  async verifyJob(user: AuthUser, id: string, ip?: string) {
    this.require(user, PERMISSIONS.PACS_ARCHIVE_MANAGE);
    const job = await this.prisma.archiveJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Archive job not found');
    this.assertOrg(user, job.organizationId);
    if (!job.archivePath || !job.sha256) throw new BadRequestException('Job has no archive to verify');
    const full = path.join(this.root, job.archivePath);
    const result = await this.verifyFile(full, job.sha256);
    const updated = await this.prisma.archiveJob.update({
      where: { id },
      data: { verified: result.ok, verifiedAt: new Date(), verifyDetail: result.detail, status: result.ok ? 'VERIFIED' : job.status },
    });
    await this.audit.log({ userId: user.id, action: 'ARCHIVE_JOB_VERIFY', status: result.ok ? 'SUCCESS' : 'FAILURE', entityType: 'ArchiveJob', entityId: id, detail: { ok: result.ok }, ip });

    // Module 5 gap-closure: on-demand integrity-verification FAILURE raises one
    // HIGH, org-scoped, pacs_admin notification, deduped per job per day. Success
    // never notifies (distinct from the archive completion/failure notification,
    // which is keyed archive-done:<jobId>). NotificationsService.create never throws,
    // so a notification problem cannot affect the verification result above.
    if (!result.ok) {
      const day = new Date().toISOString().slice(0, 10);
      await this.notifications.create({
        category: 'SYSTEM_ALERT', priority: 'HIGH',
        roleKey: 'pacs_admin', organizationId: job.organizationId ?? undefined,
        studyId: job.studyId ?? undefined,
        dedupKey: `integrity-fail:${id}:${day}`,
        title: 'Archive integrity verification failed',
        body: `On-demand verify failed for archive job ${id}: ${result.detail}`,
        link: '/pacs/archive',
      });
    }

    return this.serialize(updated);
  }

  /**
   * READ-ONLY integrity inspection for PACS Operations Module 4 (history re-verify).
   * Re-hashes + re-extracts the stored archive and compares against the recorded
   * sha256, but NEVER modifies the archive file or any ArchiveJob/verification
   * record. Requires only VIEW. The caller (ops-history) writes its own audit event.
   */
  async inspectIntegrity(user: AuthUser, id: string): Promise<{ jobId: string; ok: boolean; detail: string; expectedSha: string | null; archivePath: string | null }> {
    this.require(user, PERMISSIONS.PACS_ARCHIVE_VIEW);
    const job = await this.prisma.archiveJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Archive job not found');
    this.assertOrg(user, job.organizationId);
    if (!job.archivePath || !job.sha256) {
      return { jobId: id, ok: false, detail: 'no archive to inspect', expectedSha: job.sha256 ?? null, archivePath: job.archivePath ?? null };
    }
    const result = await this.verifyFile(path.join(this.root, job.archivePath), job.sha256);
    // NO prisma update — history inspection is non-mutating by contract.
    return { jobId: id, ok: result.ok, detail: result.detail, expectedSha: job.sha256, archivePath: job.archivePath };
  }

  /** Restore (extract) an archive to a restore folder for inspection. Copy-only:
   * this does NOT re-import into Orthanc or alter source data. */
  async restoreJob(user: AuthUser, id: string, ip?: string) {
    this.require(user, PERMISSIONS.PACS_ARCHIVE_MANAGE);
    const job = await this.prisma.archiveJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Archive job not found');
    this.assertOrg(user, job.organizationId);
    if (!job.archivePath) throw new BadRequestException('Job has no archive to restore');
    const full = path.join(this.root, job.archivePath);
    const restoreDir = path.join(this.root, 'restore', job.id);
    await fs.promises.mkdir(restoreDir, { recursive: true });
    // gunzip -> .zip, then list entries (we extract the inner ZIP's file count).
    const zipPath = path.join(restoreDir, 'study.zip');
    await this.gunzipTo(full, zipPath);
    const entries = this.countZipEntries(zipPath);
    await this.audit.log({ userId: user.id, action: 'ARCHIVE_JOB_RESTORE', entityType: 'ArchiveJob', entityId: id, detail: { restoreDir, entries }, ip });
    return { ok: true, restoredTo: restoreDir, zipEntries: entries, note: 'Copy-only extraction. Original Orthanc data unchanged; no re-import performed.' };
  }

  // ───────────────────────── executor (scheduler) ─────────────────────────

  async runNextQueuedJob(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const job = await this.prisma.archiveJob.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
      if (!job) return false;
      await this.executeJob(job.id);
      return true;
    } catch (e: any) { this.log.error(`runNextQueuedJob: ${e?.message}`); return false; }
    finally { this.running = false; }
  }

  /** Public recovery entry point — run by the scheduler on every tick, OUTSIDE the
   * job-execution lock, so a stuck lock from a crashed process cannot block it. */
  async recover(): Promise<void> { await this.recoverStuckJobs(); }

  private async executeJob(jobId: string) {
    const job = await this.prisma.archiveJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'QUEUED') return;
    if (job.cancelRequested) { await this.prisma.archiveJob.update({ where: { id: jobId }, data: { status: 'CANCELLED', completedAt: new Date() } }); return; }
    const start = Date.now();
    await this.prisma.archiveJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } });

    const tmpZip = path.join(this.root, 'tmp', `${jobId}.zip`);
    const relPath = path.join('studies', `${this.safe(job.studyInstanceUid)}.zip.gz`);
    const outPath = path.join(this.root, relPath);
    try {
      await fs.promises.mkdir(path.dirname(tmpZip), { recursive: true });
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });

      // PROTECTION: never overwrite an existing VERIFIED archive.
      const existing = await this.prisma.archiveJob.findFirst({
        where: { studyInstanceUid: job.studyInstanceUid, verified: true, id: { not: jobId } },
      });
      if (existing && fs.existsSync(path.join(this.root, existing.archivePath ?? ''))) {
        throw new Error('A verified archive for this study already exists; refusing to overwrite');
      }

      // 1) Pull the study's Orthanc native ZIP (lossless; originals untouched).
      const origBytes = await this.downloadStudyZip(job.orthancStudyId!, tmpZip);

      // 2) gzip-wrap at the configured level in a worker thread.
      const { compressedBytes, sha256 } = await this.compressInWorker(tmpZip, outPath, job.compressionLevel);

      const ratio = origBytes > 0 ? Number((compressedBytes / origBytes).toFixed(4)) : null;
      const savings = ratio != null ? Number(((1 - ratio) * 100).toFixed(2)) : null;

      await this.prisma.archiveJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED', archivePath: relPath, sha256,
          originalBytes: BigInt(origBytes), compressedBytes: BigInt(compressedBytes),
          compressionRatio: ratio, savingsPercent: savings, completedAt: new Date(),
        },
      });
      // 3) Auto-verify integrity immediately.
      const v = await this.verifyFile(outPath, sha256);
      await this.prisma.archiveJob.update({ where: { id: jobId }, data: { verified: v.ok, verifiedAt: new Date(), verifyDetail: v.detail, status: v.ok ? 'VERIFIED' : 'COMPLETED' } });

      await this.notify(job.organizationId, jobId, v.ok ? 'VERIFIED' : 'COMPLETED', `Archive ${v.ok ? 'verified' : 'completed'}: ${(savings ?? 0)}% saved`);
      await this.audit.log({ userId: job.createdBy, action: 'ARCHIVE_JOB_DONE', status: 'SUCCESS', entityType: 'ArchiveJob', entityId: jobId, detail: { origBytes, compressedBytes, savings, verified: v.ok } });
    } catch (e: any) {
      await this.prisma.archiveJob.update({ where: { id: jobId }, data: { status: 'FAILED', error: String(e?.message).slice(0, 400), completedAt: new Date() } });
      await this.notify(job.organizationId, jobId, 'FAILED', `Archive failed: ${String(e?.message).slice(0, 120)}`);
      await this.audit.log({ userId: job.createdBy, action: 'ARCHIVE_JOB_DONE', status: 'FAILURE', entityType: 'ArchiveJob', entityId: jobId, detail: { error: String(e?.message).slice(0, 200) } });
      this.log.error(`executeJob ${jobId}: ${e?.message}`);
    } finally {
      try { if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip); } catch { /* ignore */ }
    }
  }

  /** Recover jobs left RUNNING by a backend restart: if the output archive exists
   * and hashes correctly, finalize; else mark FAILED for retry. */
  private async recoverStuckJobs() {
    const stuck = await this.prisma.archiveJob.findMany({ where: { status: 'RUNNING' }, select: { id: true, studyInstanceUid: true, startedAt: true } });
    for (const j of stuck) {
      const rel = path.join('studies', `${this.safe(j.studyInstanceUid)}.zip.gz`);
      const full = path.join(this.root, rel);
      try {
        if (fs.existsSync(full)) {
          const sha = await this.hashFile(full);
          const v = await this.verifyFile(full, sha);
          const st = fs.statSync(full);
          await this.prisma.archiveJob.update({ where: { id: j.id }, data: { status: v.ok ? 'VERIFIED' : 'COMPLETED', archivePath: rel, sha256: sha, compressedBytes: BigInt(st.size), verified: v.ok, verifiedAt: new Date(), verifyDetail: 'recovered after restart' } });
        } else {
          // Interrupted before the output archive was written (e.g. during the
          // Orthanc download). Re-queue so it retries automatically — safe because
          // archiving is copy-only and idempotent (no-overwrite guard protects a
          // verified archive). Partial temp files are cleaned on the next run.
          await this.prisma.archiveJob.update({ where: { id: j.id }, data: { status: 'QUEUED', startedAt: null, error: 'interrupted by restart; re-queued' } });
        }
      } catch (e: any) { this.log.warn(`recoverStuckJobs ${j.id}: ${e?.message}`); }
    }
  }

  // ───────────────────────── monitor ─────────────────────────

  async monitor(user: AuthUser) {
    this.require(user, PERMISSIONS.PACS_ARCHIVE_VIEW);
    const scope = this.orgScope(user);
    const [queued, running, completed, verified, failed, cancelled] = await this.prisma.$transaction([
      this.prisma.archiveJob.count({ where: { ...scope, status: 'QUEUED' } }),
      this.prisma.archiveJob.count({ where: { ...scope, status: 'RUNNING' } }),
      this.prisma.archiveJob.count({ where: { ...scope, status: 'COMPLETED' } }),
      this.prisma.archiveJob.count({ where: { ...scope, status: 'VERIFIED' } }),
      this.prisma.archiveJob.count({ where: { ...scope, status: 'FAILED' } }),
      this.prisma.archiveJob.count({ where: { ...scope, status: 'CANCELLED' } }),
    ]);
    const agg = await this.prisma.archiveJob.aggregate({ where: { ...scope, status: { in: ['COMPLETED', 'VERIFIED'] } }, _sum: { originalBytes: true, compressedBytes: true } });
    const orig = Number(agg._sum.originalBytes ?? 0);
    const comp = Number(agg._sum.compressedBytes ?? 0);
    const cfg = await this.getConfig(user);
    return {
      queue: { queued, running, completed, verified, failed, cancelled },
      storage: {
        archiveRoot: cfg.destinationRoot, archiveBytesUsed: cfg.archiveBytesUsed,
        totalOriginalBytes: orig, totalCompressedBytes: comp,
        totalSavingsBytes: orig - comp, overallSavingsPercent: orig > 0 ? Number((((orig - comp) / orig) * 100).toFixed(1)) : 0,
      },
      config: { defaultCompressionLevel: cfg.defaultCompressionLevel, workerThreads: cfg.workerThreads },
      generatedAt: new Date().toISOString(),
    };
  }

  // ───────────────────────── helpers ─────────────────────────

  private serialize(r: any) {
    return { ...r, originalBytes: r.originalBytes != null ? Number(r.originalBytes) : null, compressedBytes: r.compressedBytes != null ? Number(r.compressedBytes) : null };
  }
  private safe(s: string) { return s.replace(/[^0-9A-Za-z._-]/g, '_'); }

  private async downloadStudyZip(orthancStudyId: string, destPath: string): Promise<number> {
    const res = await fetch(`${this.orthancBase}/studies/${orthancStudyId}/archive`, { headers: { Authorization: this.orthancAuth } });
    if (!res.ok || !res.body) throw new Error(`Orthanc archive download failed: ${res.status}`);
    const { Readable } = await import('stream');
    const out = fs.createWriteStream(destPath);
    await new Promise<void>((resolve, reject) => {
      (Readable.fromWeb(res.body as any)).pipe(out).on('finish', () => resolve()).on('error', reject);
    });
    return fs.statSync(destPath).size;
  }

  private compressInWorker(srcPath: string, destPath: string, level: number): Promise<{ compressedBytes: number; sha256: string }> {
    return new Promise((resolve, reject) => {
      // Resolve the compiled worker (.js in prod, .ts via ts-node is not used at runtime).
      const workerPath = path.join(__dirname, 'archive.worker.js');
      const w = new Worker(workerPath, { workerData: { srcPath, destPath, level } });
      w.once('message', (m: any) => { w.terminate(); m.ok ? resolve({ compressedBytes: m.compressedBytes, sha256: m.sha256 }) : reject(new Error(m.error)); });
      w.once('error', reject);
      w.once('exit', (code) => { if (code !== 0) reject(new Error(`worker exited ${code}`)); });
    });
  }

  private async hashFile(file: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    await new Promise<void>((resolve, reject) => fs.createReadStream(file).on('data', (c) => hash.update(c)).on('end', () => resolve()).on('error', reject));
    return hash.digest('hex');
  }

  /** Verify: re-hash matches + the gzip stream decompresses to a valid ZIP. */
  private async verifyFile(file: string, expectedSha: string): Promise<{ ok: boolean; detail: string }> {
    try {
      if (!fs.existsSync(file)) return { ok: false, detail: 'archive file missing' };
      const sha = await this.hashFile(file);
      if (sha !== expectedSha) return { ok: false, detail: 'sha256 mismatch' };
      // decompress to a temp .zip and count entries to prove it extracts.
      const tmp = file + '.verify.zip';
      await this.gunzipTo(file, tmp);
      const entries = this.countZipEntries(tmp);
      fs.unlinkSync(tmp);
      if (entries <= 0) return { ok: false, detail: 'archive extracted to 0 entries' };
      return { ok: true, detail: `sha256 OK; extracts to ${entries} entries` };
    } catch (e: any) { return { ok: false, detail: `verify error: ${String(e?.message).slice(0, 120)}` }; }
  }

  private gunzipTo(gzPath: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.createReadStream(gzPath).pipe(zlib.createGunzip()).pipe(fs.createWriteStream(outPath)).on('finish', () => resolve()).on('error', reject);
    });
  }

  /** Count entries in a ZIP via its End-Of-Central-Directory record (no deps). */
  private countZipEntries(zipPath: string): number {
    const buf = fs.readFileSync(zipPath);
    // EOCD signature 0x06054b50, total entries at offset 10 (2 bytes LE).
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) return buf.readUInt16LE(i + 10);
    }
    return 0;
  }

  private *walk(dir: string): Generator<string> {
    let items: fs.Dirent[] = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) yield* this.walk(p); else yield p;
    }
  }

  private async notify(orgId: string | null | undefined, jobId: string, status: string, msg: string) {
    await this.notifications.create({
      category: 'SYSTEM_ALERT', priority: status === 'FAILED' ? 'HIGH' : 'NORMAL',
      roleKey: 'pacs_admin', organizationId: orgId ?? undefined,
      dedupKey: `archive-done:${jobId}`,
      title: `Study archive ${status.toLowerCase()}`, body: msg, link: '/pacs/archive',
    });
  }
}
