import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ArchiveService } from './archive.service';
import { OrthancService } from '../orthanc/orthanc.service';
import { AuthUser } from '../auth/current-user.decorator';
import { PERMISSIONS } from '../rbac/permissions';

/**
 * PACS Operations — Module 4: Transfer & Archive History.
 * READ-ONLY reporting over the existing reverse-push (Module 1) and archive
 * (Module 2) records. Never writes to job/instance/verification records; never
 * touches DICOM or archives (the one re-verify path delegates to a non-mutating
 * inspector). Per-source RBAC: a caller sees reverse-push data only with
 * pacs.reverse-push.view and archive data only with pacs.archive.view (super
 * admin = both); at least one is required. Patient MRN is shown only with
 * patient.view. Org isolation on every query.
 */

export type OperationType = 'REVERSE_PUSH' | 'ARCHIVE';

export interface OperationRow {
  type: OperationType;
  id: string;
  studyInstanceUid: string;
  patientMrn: string | null;
  modality: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  summary: Record<string, any>;
}

type DateRange = 'today' | '7d' | '30d' | '30' | 'custom' | 'all' | string;

@Injectable()
export class OperationsHistoryService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private archive: ArchiveService,
    private orthanc: OrthancService,
  ) {}

  // ───────────────────────── RBAC helpers ─────────────────────────

  visibleSources(u: AuthUser): { reversePush: boolean; archive: boolean } {
    if (u.isSuperAdmin) return { reversePush: true, archive: true };
    return {
      reversePush: u.permissions.includes(PERMISSIONS.PACS_REVERSE_PUSH_VIEW),
      archive: u.permissions.includes(PERMISSIONS.PACS_ARCHIVE_VIEW),
    };
  }

  private requireAnySource(u: AuthUser): { reversePush: boolean; archive: boolean } {
    const v = this.visibleSources(u);
    if (!v.reversePush && !v.archive) {
      throw new ForbiddenException('Requires pacs.reverse-push.view or pacs.archive.view');
    }
    return v;
  }

  private canSeePatient(u: AuthUser): boolean {
    return u.isSuperAdmin || u.permissions.includes(PERMISSIONS.PATIENT_VIEW);
  }

  private canSeeManage(u: AuthUser): boolean {
    return u.isSuperAdmin || u.permissions.includes(PERMISSIONS.PACS_ARCHIVE_MANAGE);
  }

  /** Org filter for Prisma where-clauses. Super admin → no restriction. */
  private orgWhere(u: AuthUser): { organizationId?: string } {
    return u.isSuperAdmin ? {} : { organizationId: u.organizationId ?? '__none__' };
  }

  private assertOrg(u: AuthUser, orgId?: string | null) {
    if (u.isSuperAdmin) return;
    if (!orgId || orgId !== u.organizationId) throw new ForbiddenException('Resource belongs to another organization');
  }

  // ───────────────────────── Study lookup (patient MRN + modality) ─────────────────────────

  /**
   * Batched lookup of patient MRN + modality for a set of jobs. Jobs carry only
   * studyId / studyInstanceUid; MRN lives on Patient, modality on Study. Returns
   * maps keyed by studyId and by studyInstanceUid so either can resolve.
   */
  private async studyLookup(studyIds: (string | null)[], uids: (string | null)[]): Promise<{
    byId: Map<string, { mrn: string | null; modality: string | null }>;
    byUid: Map<string, { mrn: string | null; modality: string | null }>;
  }> {
    const ids = [...new Set(studyIds.filter((x): x is string => !!x))];
    const us = [...new Set(uids.filter((x): x is string => !!x))];
    const byId = new Map<string, { mrn: string | null; modality: string | null }>();
    const byUid = new Map<string, { mrn: string | null; modality: string | null }>();
    if (ids.length === 0 && us.length === 0) return { byId, byUid };
    const studies = await this.prisma.study.findMany({
      where: { OR: [{ id: { in: ids } }, { studyInstanceUid: { in: us } }] },
      select: { id: true, studyInstanceUid: true, modality: true, patient: { select: { mrn: true } } },
    });
    for (const s of studies) {
      const v = { mrn: s.patient?.mrn ?? null, modality: s.modality ?? null };
      byId.set(s.id, v);
      byUid.set(s.studyInstanceUid, v);
    }
    return { byId, byUid };
  }

  private resolveStudy(
    lookup: { byId: Map<string, any>; byUid: Map<string, any> },
    studyId: string | null | undefined,
    uid: string,
  ): { mrn: string | null; modality: string | null } {
    return (studyId && lookup.byId.get(studyId)) || lookup.byUid.get(uid) || { mrn: null, modality: null };
  }

  // ───────────────────────── Normalization ─────────────────────────

  private normalizeTransferJob(job: any, lookup: any, seePatient: boolean): OperationRow {
    const s = this.resolveStudy(lookup, job.studyId, job.studyInstanceUid);
    return {
      type: 'REVERSE_PUSH',
      id: job.id,
      studyInstanceUid: job.studyInstanceUid,
      patientMrn: seePatient ? s.mrn : null,
      modality: s.modality,
      status: job.status,
      createdBy: job.createdBy ?? null,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt ? job.startedAt.toISOString() : null,
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      summary: {
        destination: job.destination ? { id: job.destination.id, name: job.destination.name, aeTitle: job.destination.aeTitle } : null,
        totalInstances: job.totalInstances,
        successInstances: job.successInstances,
        failedInstances: job.failedInstances,
        pendingInstances: job.pendingInstances,
        retryCount: job.retryCount,
        durationMs: job.startedAt && job.completedAt ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime() : null,
      },
    };
  }

  private normalizeArchiveJob(job: any, lookup: any, seePatient: boolean): OperationRow {
    const s = this.resolveStudy(lookup, job.studyId, job.studyInstanceUid);
    return {
      type: 'ARCHIVE',
      id: job.id,
      studyInstanceUid: job.studyInstanceUid,
      patientMrn: seePatient ? s.mrn : null,
      modality: s.modality,
      status: job.status,
      createdBy: job.createdBy ?? null,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt ? job.startedAt.toISOString() : null,
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      summary: {
        originalBytes: job.originalBytes != null ? Number(job.originalBytes) : null,
        compressedBytes: job.compressedBytes != null ? Number(job.compressedBytes) : null,
        compressionRatio: job.compressionRatio ?? null,
        savingsPercent: job.savingsPercent ?? null,
        instanceCount: job.instanceCount,
        sha256: job.sha256 ?? null,
        verified: job.verified,
        durationMs: job.startedAt && job.completedAt ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime() : null,
      },
    };
  }

  // ───────────────────────── Filters ─────────────────────────

  private resolveWindow(range: DateRange, from?: string, to?: string): { gte?: Date; lte?: Date } | null {
    const now = new Date();
    if (range === 'all' || (!range && !from && !to)) return null;
    if (range === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return { gte: d }; }
    if (range === '7d' || range === '7') { const d = new Date(now.getTime() - 7 * 86400000); return { gte: d }; }
    if (range === '30d' || range === '30') { const d = new Date(now.getTime() - 30 * 86400000); return { gte: d }; }
    if (range === 'custom' || from || to) {
      const gte = from ? new Date(from) : undefined;
      const lte = to ? new Date(to) : undefined;
      if (gte && isNaN(gte.getTime())) return { gte: new Date(0), lte: new Date(0) }; // bad input → empty
      if (lte && isNaN(lte.getTime())) return { gte: new Date(0), lte: new Date(0) };
      if (gte && lte && gte.getTime() > lte.getTime()) return { gte: new Date(0), lte: new Date(0) }; // from>to → empty
      return { gte, lte };
    }
    return null;
  }

  /** Build per-source Prisma where clauses from the query filters. */
  private async buildFilters(u: AuthUser, q: any): Promise<{ rpWhere: any; arWhere: any }> {
    const org = this.orgWhere(u);
    const window = this.resolveWindow(q.range, q.from, q.to);
    const createdAt = window ? { ...(window.gte ? { gte: window.gte } : {}), ...(window.lte ? { lte: window.lte } : {}) } : undefined;

    // Patient MRN / modality filters resolve through Study → studyInstanceUid set.
    let uidFilter: string[] | undefined;
    if (q.patientMrn || q.modality) {
      const studies = await this.prisma.study.findMany({
        where: {
          ...(q.modality ? { modality: q.modality } : {}),
          ...(q.patientMrn ? { patient: { mrn: q.patientMrn } } : {}),
        },
        select: { studyInstanceUid: true },
      });
      uidFilter = studies.map((s) => s.studyInstanceUid);
      if (uidFilter.length === 0) uidFilter = ['__no_match__'];
    }

    const common = (isArchive: boolean) => {
      const w: any = { ...org };
      if (createdAt) w.createdAt = createdAt;
      if (q.studyUid) w.studyInstanceUid = q.studyUid;
      else if (uidFilter) w.studyInstanceUid = { in: uidFilter };
      if (q.status) w.status = q.status;
      if (q.createdBy) w.createdBy = q.createdBy;
      if (isArchive && q.verified != null && q.verified !== '') w.verified = q.verified === 'true' || q.verified === true;
      if (!isArchive && q.destinationId) w.destinationId = q.destinationId;
      return w;
    };
    return { rpWhere: common(false), arWhere: common(true) };
  }

  private sortField(q: any): string {
    const allowed = ['createdAt', 'completedAt', 'status'];
    return allowed.includes(q.sortBy) ? q.sortBy : 'createdAt';
  }
  private sortDir(q: any): 'asc' | 'desc' {
    return q.sortDir === 'asc' ? 'asc' : 'desc';
  }

  // ───────────────────────── Lists ─────────────────────────

  async list(u: AuthUser, q: any): Promise<{ data: OperationRow[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const v = this.requireAnySource(u);
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const { rpWhere, arWhere } = await this.buildFilters(u, q);
    const typeFilter: OperationType | undefined = q.type === 'REVERSE_PUSH' || q.type === 'ARCHIVE' ? q.type : undefined;

    const useRp = v.reversePush && typeFilter !== 'ARCHIVE';
    const useAr = v.archive && typeFilter !== 'REVERSE_PUSH';
    const field = this.sortField(q);
    const dir = this.sortDir(q);
    const fetch = page * pageSize; // enough from each source to cover the page after merge

    const [rpCount, arCount, rpJobs, arJobs] = await Promise.all([
      useRp ? this.prisma.dicomTransferJob.count({ where: rpWhere }) : Promise.resolve(0),
      useAr ? this.prisma.archiveJob.count({ where: arWhere }) : Promise.resolve(0),
      useRp ? this.prisma.dicomTransferJob.findMany({ where: rpWhere, include: { destination: true }, orderBy: { [field]: dir }, take: fetch }) : Promise.resolve([]),
      useAr ? this.prisma.archiveJob.findMany({ where: arWhere, orderBy: { [field]: dir }, take: fetch }) : Promise.resolve([]),
    ]);

    const lookup = await this.studyLookup(
      [...rpJobs.map((j: any) => j.studyId), ...arJobs.map((j: any) => j.studyId)],
      [...rpJobs.map((j: any) => j.studyInstanceUid), ...arJobs.map((j: any) => j.studyInstanceUid)],
    );
    const seePatient = this.canSeePatient(u);
    const merged: OperationRow[] = [
      ...rpJobs.map((j: any) => this.normalizeTransferJob(j, lookup, seePatient)),
      ...arJobs.map((j: any) => this.normalizeArchiveJob(j, lookup, seePatient)),
    ];
    merged.sort((a, b) => {
      const av = (a as any)[field] ?? a.createdAt;
      const bv = (b as any)[field] ?? b.createdAt;
      const cmp = String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
    const total = rpCount + arCount;
    const start = (page - 1) * pageSize;
    return { data: merged.slice(start, start + pageSize), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async listReversePush(u: AuthUser, q: any) {
    const v = this.requireAnySource(u);
    if (!v.reversePush) throw new ForbiddenException('Requires pacs.reverse-push.view');
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const { rpWhere } = await this.buildFilters(u, q);
    const [total, jobs] = await Promise.all([
      this.prisma.dicomTransferJob.count({ where: rpWhere }),
      this.prisma.dicomTransferJob.findMany({ where: rpWhere, include: { destination: true }, orderBy: { [this.sortField(q)]: this.sortDir(q) }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const lookup = await this.studyLookup(jobs.map((j) => j.studyId), jobs.map((j) => j.studyInstanceUid));
    const seePatient = this.canSeePatient(u);
    return { data: jobs.map((j) => this.normalizeTransferJob(j, lookup, seePatient)), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async listArchive(u: AuthUser, q: any) {
    const v = this.requireAnySource(u);
    if (!v.archive) throw new ForbiddenException('Requires pacs.archive.view');
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const { arWhere } = await this.buildFilters(u, q);
    const [total, jobs] = await Promise.all([
      this.prisma.archiveJob.count({ where: arWhere }),
      this.prisma.archiveJob.findMany({ where: arWhere, orderBy: { [this.sortField(q)]: this.sortDir(q) }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const lookup = await this.studyLookup(jobs.map((j) => j.studyId), jobs.map((j) => j.studyInstanceUid));
    const seePatient = this.canSeePatient(u);
    return { data: jobs.map((j) => this.normalizeArchiveJob(j, lookup, seePatient)), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  // ───────────────────────── Dashboard ─────────────────────────

  async dashboard(u: AuthUser, q: any) {
    const v = this.requireAnySource(u);
    const { rpWhere, arWhere } = await this.buildFilters(u, q);
    const seePatient = this.canSeePatient(u);

    let reversePush: any = null;
    if (v.reversePush) {
      const grouped = await this.prisma.dicomTransferJob.groupBy({ by: ['status'], where: rpWhere, _count: { _all: true } });
      const byStatus = Object.fromEntries(grouped.map((g: any) => [g.status, g._count._all]));
      const total = grouped.reduce((s: number, g: any) => s + g._count._all, 0);
      reversePush = {
        total,
        success: byStatus['COMPLETED'] ?? 0,
        failed: byStatus['FAILED'] ?? 0,
        partial: byStatus['PARTIALLY_COMPLETED'] ?? 0,
        pending: (byStatus['PENDING'] ?? 0) + (byStatus['QUEUED'] ?? 0) + (byStatus['RUNNING'] ?? 0),
        cancelled: byStatus['CANCELLED'] ?? 0,
      };
    }

    let archive: any = null;
    if (v.archive) {
      const grouped = await this.prisma.archiveJob.groupBy({ by: ['status'], where: arWhere, _count: { _all: true } });
      const byStatus = Object.fromEntries(grouped.map((g: any) => [g.status, g._count._all]));
      const total = grouped.reduce((s: number, g: any) => s + g._count._all, 0);
      const sums = await this.prisma.archiveJob.aggregate({ where: arWhere, _sum: { originalBytes: true, compressedBytes: true } });
      const original = sums._sum.originalBytes != null ? Number(sums._sum.originalBytes) : 0;
      const compressed = sums._sum.compressedBytes != null ? Number(sums._sum.compressedBytes) : 0;
      archive = {
        total,
        verified: byStatus['VERIFIED'] ?? 0,
        completed: byStatus['COMPLETED'] ?? 0,
        failed: byStatus['FAILED'] ?? 0,
        pending: (byStatus['PENDING'] ?? 0) + (byStatus['QUEUED'] ?? 0) + (byStatus['RUNNING'] ?? 0),
        originalBytes: original,
        compressedBytes: compressed,
        savingsBytes: Math.max(0, original - compressed),
        savingsPercent: original > 0 ? Math.round((1 - compressed / original) * 1000) / 10 : 0,
      };
    }

    // Recent: latest rows across visible sources.
    const field = 'createdAt';
    const recentN = 10;
    const [rpRecent, arRecent] = await Promise.all([
      v.reversePush ? this.prisma.dicomTransferJob.findMany({ where: rpWhere, include: { destination: true }, orderBy: { [field]: 'desc' }, take: recentN }) : Promise.resolve([]),
      v.archive ? this.prisma.archiveJob.findMany({ where: arWhere, orderBy: { [field]: 'desc' }, take: recentN }) : Promise.resolve([]),
    ]);
    const lookup = await this.studyLookup(
      [...rpRecent.map((j: any) => j.studyId), ...arRecent.map((j: any) => j.studyId)],
      [...rpRecent.map((j: any) => j.studyInstanceUid), ...arRecent.map((j: any) => j.studyInstanceUid)],
    );
    const recent = [
      ...rpRecent.map((j: any) => this.normalizeTransferJob(j, lookup, seePatient)),
      ...arRecent.map((j: any) => this.normalizeArchiveJob(j, lookup, seePatient)),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, recentN);

    return { range: q.range ?? 'all', reversePush, archive, recent, generatedAt: new Date().toISOString() };
  }

  // ───────────────────────── Detail ─────────────────────────

  async reversePushDetail(u: AuthUser, jobId: string) {
    const v = this.requireAnySource(u);
    if (!v.reversePush) throw new ForbiddenException('Requires pacs.reverse-push.view');
    const job = await this.prisma.dicomTransferJob.findUnique({ where: { id: jobId }, include: { destination: true, instances: { orderBy: { sentAt: 'asc' } } } });
    if (!job) throw new NotFoundException('Transfer job not found');
    this.assertOrg(u, job.organizationId);
    const lookup = await this.studyLookup([job.studyId].filter(Boolean) as string[], [job.studyInstanceUid]);
    const s = this.resolveStudy(lookup, job.studyId, job.studyInstanceUid);
    const seePatient = this.canSeePatient(u);
    return {
      type: 'REVERSE_PUSH',
      id: job.id,
      studyInstanceUid: job.studyInstanceUid,
      patientMrn: seePatient ? s.mrn : null,
      modality: s.modality,
      status: job.status,
      destination: { name: job.destination?.name, aeTitle: job.destination?.aeTitle, host: job.destination?.host, port: job.destination?.port },
      totalInstances: job.totalInstances,
      successInstances: job.successInstances,
      failedInstances: job.failedInstances,
      pendingInstances: job.pendingInstances,
      retryCount: job.retryCount,
      lastError: job.lastError ?? null,
      transferSpeedKbps: job.transferSpeedKbps ?? null,
      createdBy: job.createdBy ?? null,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt ? job.startedAt.toISOString() : null,
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      instances: job.instances.map((i) => ({ sopInstanceUid: i.sopInstanceUid, status: i.status, error: i.error ?? null, sentAt: i.sentAt ? i.sentAt.toISOString() : null })),
    };
  }

  async archiveDetail(u: AuthUser, jobId: string) {
    const v = this.requireAnySource(u);
    if (!v.archive) throw new ForbiddenException('Requires pacs.archive.view');
    const job = await this.prisma.archiveJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Archive job not found');
    this.assertOrg(u, job.organizationId);
    const lookup = await this.studyLookup([job.studyId].filter(Boolean) as string[], [job.studyInstanceUid]);
    const s = this.resolveStudy(lookup, job.studyId, job.studyInstanceUid);
    const seePatient = this.canSeePatient(u);
    return {
      type: 'ARCHIVE',
      id: job.id,
      studyInstanceUid: job.studyInstanceUid,
      patientMrn: seePatient ? s.mrn : null,
      modality: s.modality,
      status: job.status,
      originalBytes: job.originalBytes != null ? Number(job.originalBytes) : null,
      compressedBytes: job.compressedBytes != null ? Number(job.compressedBytes) : null,
      compressionRatio: job.compressionRatio ?? null,
      savingsPercent: job.savingsPercent ?? null,
      compressionLevel: job.compressionLevel,
      workerCount: job.workerCount,
      instanceCount: job.instanceCount,
      sha256: job.sha256 ?? null,
      verified: job.verified,
      verifyDetail: job.verifyDetail ?? null,
      // Archive path is infrastructure; only managers see it.
      archivePath: this.canSeeManage(u) ? (job.archivePath ?? null) : undefined,
      createdBy: job.createdBy ?? null,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt ? job.startedAt.toISOString() : null,
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      verifiedAt: job.verifiedAt ? job.verifiedAt.toISOString() : null,
    };
  }

  // ───────────────────────── Per-study aggregate (Module 5) ─────────────────────────

  /** DICOM UID: dot-separated numeric components, max 64 chars (DICOM VR UI). */
  private isValidUid(uid: string): boolean {
    return typeof uid === 'string' && uid.length > 0 && uid.length <= 64 && /^[0-9]+(\.[0-9]+)*$/.test(uid);
  }

  /**
   * Study-level operational aggregate (Module 5). READ-ONLY. Reuses this
   * service's OR-gate, org isolation, patient gating, and normalizers.
   *  - UID is validated/normalized before any DB access (bad input → 400).
   *  - A study in another org (or no org, for a scoped user) → 404, never 403,
   *    so the endpoint does not reveal that another org's study exists.
   *  - Transfers shown only with reverse-push.view; archives only with archive.view.
   *  - Patient MRN only with patient.view (via the normalizers + study block).
   */
  async studyOperations(u: AuthUser, uid: string) {
    const v = this.requireAnySource(u);
    if (!this.isValidUid(uid)) throw new BadRequestException('Invalid Study Instance UID');

    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: uid },
      select: {
        id: true, studyInstanceUid: true, modality: true, studyDate: true,
        accessionNumber: true, description: true, imageCount: true,
        orthancStudyId: true, organizationId: true, isReconciled: true,
        patient: { select: { mrn: true } },
      },
    });
    // Non-existent AND cross-org both resolve to 404 (no existence leak).
    if (!study) throw new NotFoundException('Study not found');
    if (!u.isSuperAdmin && (!study.organizationId || study.organizationId !== u.organizationId)) {
      throw new NotFoundException('Study not found');
    }

    const seePatient = this.canSeePatient(u);
    const org = this.orgWhere(u);

    const [rpJobs, arJobs] = await Promise.all([
      v.reversePush
        ? this.prisma.dicomTransferJob.findMany({ where: { studyInstanceUid: uid, ...org }, include: { destination: true }, orderBy: { createdAt: 'desc' } })
        : Promise.resolve([] as any[]),
      v.archive
        ? this.prisma.archiveJob.findMany({ where: { studyInstanceUid: uid, ...org }, orderBy: { createdAt: 'desc' } })
        : Promise.resolve([] as any[]),
    ]);

    // Reuse the exact normalizers (they already honor seePatient). Provide a
    // lookup pre-seeded from this study so MRN/modality resolve without a 2nd query.
    const lookup = {
      byId: new Map<string, any>([[study.id, { mrn: study.patient?.mrn ?? null, modality: study.modality ?? null }]]),
      byUid: new Map<string, any>([[uid, { mrn: study.patient?.mrn ?? null, modality: study.modality ?? null }]]),
    };
    const transfers = rpJobs.map((j: any) => this.normalizeTransferJob(j, lookup, seePatient));
    const archives = arJobs.map((j: any) => this.normalizeArchiveJob(j, lookup, seePatient));

    // Latest integrity from the most recent archive job (archive source only).
    let latestIntegrity: any = null;
    if (v.archive && arJobs.length > 0) {
      const latest = arJobs[0];
      latestIntegrity = {
        archiveJobId: latest.id,
        verified: latest.verified,
        verifiedAt: latest.verifiedAt ? latest.verifiedAt.toISOString() : null,
        status: latest.status,
        detail: latest.verifyDetail ?? null,
        // sha256 is integrity info, shown to any archive viewer; archivePath stays manage-gated and is omitted here.
        sha256: latest.sha256 ?? null,
      };
    }

    // Instance count + study bytes from Orthanc ONLY if linked; never fabricate.
    let storage: { studyBytes: number | null; instances: number | null } | null = null;
    if (study.orthancStudyId) {
      try {
        const st: any = await this.orthanc.getStudyStatistics(study.orthancStudyId);
        storage = {
          studyBytes: st?.DiskSize != null ? Number(st.DiskSize) : null,
          instances: st?.CountInstances != null ? Number(st.CountInstances) : null,
        };
      } catch {
        storage = { studyBytes: null, instances: null };
      }
    }

    await this.audit.log({
      userId: u.id, action: 'OPS_INTEGRATION_STUDY_VIEW', entityType: 'Study', entityId: study.id,
      detail: { studyInstanceUid: uid, transfers: transfers.length, archives: archives.length },
    });

    return {
      study: {
        studyInstanceUid: study.studyInstanceUid,
        patientMrn: seePatient ? (study.patient?.mrn ?? null) : null,
        modality: study.modality ?? null,
        studyDate: study.studyDate ? study.studyDate.toISOString() : null,
        accessionNumber: study.accessionNumber ?? null,
        description: study.description ?? null,
        instanceCount: study.imageCount,
        isReconciled: study.isReconciled,
        hasImages: !!study.orthancStudyId,
      },
      transfers,
      archives,
      latestIntegrity,
      storage,
      summary: {
        transferCount: transfers.length,
        archiveCount: archives.length,
        transferCompleted: transfers.filter((t) => t.status === 'COMPLETED').length,
        transferFailed: transfers.filter((t) => t.status === 'FAILED' || t.status === 'PARTIALLY_COMPLETED').length,
        archiveVerified: archives.filter((a) => a.status === 'VERIFIED').length,
        archiveFailed: archives.filter((a) => a.status === 'FAILED').length,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Non-mutating on-demand re-verify: delegates to ArchiveService.inspectIntegrity
   * (re-hash + re-extract, NO record/file mutation) and writes an audit event.
   */
  async reverifyArchive(u: AuthUser, jobId: string, ip?: string) {
    const v = this.requireAnySource(u);
    if (!v.archive) throw new ForbiddenException('Requires pacs.archive.view');
    const result = await this.archive.inspectIntegrity(u, jobId);
    await this.audit.log({
      userId: u.id,
      action: 'OPS_HISTORY_ARCHIVE_REVERIFY',
      status: result.ok ? 'SUCCESS' : 'FAILURE',
      entityType: 'ArchiveJob',
      entityId: jobId,
      detail: { ok: result.ok, detail: result.detail },
      ip,
    });
    return { jobId, ok: result.ok, detail: result.detail };
  }

  // ───────────────────────── CSV export ─────────────────────────

  async exportCsv(u: AuthUser, kind: string, q: any, ip?: string): Promise<string> {
    const v = this.requireAnySource(u);
    const cap = 10000;
    const seePatient = this.canSeePatient(u);
    const { rpWhere, arWhere } = await this.buildFilters(u, q);
    const field = this.sortField(q);
    const dir = this.sortDir(q);

    let headers: string[] = [];
    let rows: string[][] = [];

    const rpRows = async () => {
      if (!v.reversePush) return [] as any[];
      return this.prisma.dicomTransferJob.findMany({ where: rpWhere, include: { destination: true }, orderBy: { [field]: dir }, take: cap });
    };
    const arRows = async () => {
      if (!v.archive) return [] as any[];
      return this.prisma.archiveJob.findMany({ where: arWhere, orderBy: { [field]: dir }, take: cap });
    };

    if (kind === 'reverse-push') {
      const jobs = await rpRows();
      const lookup = await this.studyLookup(jobs.map((j: any) => j.studyId), jobs.map((j: any) => j.studyInstanceUid));
      headers = ['jobId', 'destination', ...(seePatient ? ['patientMrn'] : []), 'studyInstanceUid', 'modality', 'totalInstances', 'successInstances', 'failedInstances', 'status', 'createdBy', 'createdAt', 'completedAt'];
      rows = jobs.map((j: any) => {
        const s = this.resolveStudy(lookup, j.studyId, j.studyInstanceUid);
        return [j.id, j.destination?.name ?? '', ...(seePatient ? [s.mrn ?? ''] : []), j.studyInstanceUid, s.modality ?? '', j.totalInstances, j.successInstances, j.failedInstances, j.status, j.createdBy ?? '', j.createdAt.toISOString(), j.completedAt ? j.completedAt.toISOString() : ''].map(String);
      });
    } else if (kind === 'archive') {
      const jobs = await arRows();
      const lookup = await this.studyLookup(jobs.map((j: any) => j.studyId), jobs.map((j: any) => j.studyInstanceUid));
      headers = ['jobId', ...(seePatient ? ['patientMrn'] : []), 'studyInstanceUid', 'modality', 'originalBytes', 'compressedBytes', 'savingsPercent', 'sha256', 'verified', 'status', 'createdBy', 'completedAt'];
      rows = jobs.map((j: any) => {
        const s = this.resolveStudy(lookup, j.studyId, j.studyInstanceUid);
        return [j.id, ...(seePatient ? [s.mrn ?? ''] : []), j.studyInstanceUid, s.modality ?? '', j.originalBytes != null ? Number(j.originalBytes) : '', j.compressedBytes != null ? Number(j.compressedBytes) : '', j.savingsPercent ?? '', j.sha256 ?? '', j.verified, j.status, j.createdBy ?? '', j.completedAt ? j.completedAt.toISOString() : ''].map(String);
      });
    } else if (kind === 'summary') {
      const d = await this.dashboard(u, q);
      headers = ['metric', 'value'];
      const flat: [string, any][] = [];
      if (d.reversePush) for (const [k, val] of Object.entries(d.reversePush)) flat.push([`reversePush.${k}`, val]);
      if (d.archive) for (const [k, val] of Object.entries(d.archive)) flat.push([`archive.${k}`, val]);
      rows = flat.map(([k, val]) => [k, String(val)]);
    } else {
      // unified (default)
      const [rpJobs, arJobs] = await Promise.all([rpRows(), arRows()]);
      const lookup = await this.studyLookup(
        [...rpJobs.map((j: any) => j.studyId), ...arJobs.map((j: any) => j.studyId)],
        [...rpJobs.map((j: any) => j.studyInstanceUid), ...arJobs.map((j: any) => j.studyInstanceUid)],
      );
      const all = [
        ...rpJobs.map((j: any) => this.normalizeTransferJob(j, lookup, seePatient)),
        ...arJobs.map((j: any) => this.normalizeArchiveJob(j, lookup, seePatient)),
      ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, cap);
      headers = ['type', 'id', ...(seePatient ? ['patientMrn'] : []), 'studyInstanceUid', 'modality', 'status', 'createdBy', 'createdAt', 'completedAt'];
      rows = all.map((r) => [r.type, r.id, ...(seePatient ? [r.patientMrn ?? ''] : []), r.studyInstanceUid, r.modality ?? '', r.status, r.createdBy ?? '', r.createdAt, r.completedAt ?? ''].map(String));
    }

    await this.audit.log({ userId: u.id, action: 'OPS_HISTORY_EXPORT', detail: { kind, rows: rows.length, filters: { range: q.range, status: q.status, type: q.type } }, ip });
    const lines = [headers.join(',')];
    for (const r of rows) lines.push(r.map(csv).join(','));
    return `# Operations history export | kind=${kind} | by ${u.username} | ${new Date().toISOString()} | ${rows.length} rows\n` + lines.join('\n') + '\n';
  }
}

/** Formula-injection-safe CSV cell (same guard used across the app's exports). */
function csv(v: any): string { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; }
