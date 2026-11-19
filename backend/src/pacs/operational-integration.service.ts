import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OperationsHistoryService } from './operations-history.service';
import { StorageService } from './storage.service';
import { HealthService } from '../ops/health.service';
import { AlertsService } from '../ops/alerts.service';
import { AuthUser } from '../auth/current-user.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { orgScope } from '../common/tenant';

/**
 * PACS Operations — Module 5: Operational Integration.
 *
 * READ-ONLY composition layer. It orchestrates existing Module 1–4 + Phase 8
 * services to present one operational picture; it owns NO new table and NO
 * mutation logic (no retry/cancel/pause/resume/verify/restore here — those stay
 * in their owning modules and are only *referenced* by the exceptions console).
 *
 * Permission model (per-section, server-side, OR at the endpoint):
 *  - transfer tile  → pacs.reverse-push.view
 *  - archive tile   → pacs.archive.view
 *  - storage tile   → pacs.storage.view
 *  - health tile    → system.health.view
 *  - alerts tile    → system.alert.view
 * The endpoint requires AT LEAST ONE of the above (else 403). Each tile is built
 * only for a caller who holds its permission, so numbers never leak across a
 * permission the caller lacks. Patient MRN in the recent strip is gated by
 * patient.view (delegated to Module 4's normalization). Org isolation on every
 * query via orgScope / Module 4's own org filter.
 */
@Injectable()
export class OperationalIntegrationService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private history: OperationsHistoryService,
    private storage: StorageService,
    private health: HealthService,
    private alerts: AlertsService,
  ) {}

  private has(u: AuthUser, perm: string): boolean {
    return u.isSuperAdmin || u.permissions.includes(perm);
  }

  private canTransfer(u: AuthUser) { return this.has(u, PERMISSIONS.PACS_REVERSE_PUSH_VIEW); }
  private canArchive(u: AuthUser) { return this.has(u, PERMISSIONS.PACS_ARCHIVE_VIEW); }
  private canStorage(u: AuthUser) { return this.has(u, PERMISSIONS.PACS_STORAGE_VIEW); }
  private canHealth(u: AuthUser) { return this.has(u, PERMISSIONS.SYSTEM_HEALTH_VIEW); }
  private canAlerts(u: AuthUser) { return this.has(u, PERMISSIONS.SYSTEM_ALERT_VIEW); }

  /** Org-scoped status breakdown for a job table (source-of-truth counts, read-only). */
  private async statusBuckets(model: 'dicomTransferJob' | 'archiveJob', u: AuthUser) {
    const where = orgScope(u);
    const grouped = await (this.prisma as any)[model].groupBy({ by: ['status'], where, _count: { _all: true } });
    const by: Record<string, number> = {};
    for (const g of grouped) by[g.status] = g._count._all;
    const total = Object.values(by).reduce((s, n) => s + n, 0);
    return {
      total,
      completed: by['COMPLETED'] ?? 0,
      verified: by['VERIFIED'] ?? 0,
      failed: by['FAILED'] ?? 0,
      partial: by['PARTIALLY_COMPLETED'] ?? 0,
      running: by['RUNNING'] ?? 0,
      queued: by['QUEUED'] ?? 0,
      pending: by['PENDING'] ?? 0,
      cancelled: by['CANCELLED'] ?? 0,
    };
  }

  /**
   * Command Centre overview (A). Each tile is permission-gated; a caller with no
   * operational view permission at all gets 403. All numbers come from real
   * services/DB — no mock. Read-only.
   */
  async overview(u: AuthUser) {
    const canAny =
      this.canTransfer(u) || this.canArchive(u) || this.canStorage(u) ||
      this.canHealth(u) || this.canAlerts(u);
    if (!canAny) {
      throw new ForbiddenException(
        'Requires one of: pacs.reverse-push.view, pacs.archive.view, pacs.storage.view, system.health.view, system.alert.view',
      );
    }

    // Module 4 dashboard is the single source of truth for transfer/archive totals,
    // byte sums, and the patient-gated recent strip. Call it only if the caller can
    // see at least one of its two sources (it enforces its own OR-gate + patient
    // gating + org isolation). Guard so a storage/health/alerts-only user still works.
    let history: any = null;
    if (this.canTransfer(u) || this.canArchive(u)) {
      history = await this.history.dashboard(u, { range: 'all' });
    }

    const transfer = this.canTransfer(u) ? await this.statusBuckets('dicomTransferJob', u) : null;
    const archive = this.canArchive(u) ? await this.statusBuckets('archiveJob', u) : null;

    // Cross-check: statusBuckets total must equal Module 4 dashboard total (same
    // rows, same org filter) — they are one source of truth, split differently.
    if (transfer && history?.reversePush) transfer.total = history.reversePush.total;
    if (archive && history?.archive) archive.total = history.archive.total;

    const storage = this.canStorage(u) ? await this.storage.dashboard(u) : null;
    const health = this.canHealth(u) ? await this.health.latest() : null;
    const alerts = this.canAlerts(u) ? await this.alerts.openCount(u) : null;

    return {
      transfer,
      archive,
      storage: storage
        ? { disk: storage.disk, orthanc: storage.orthanc, archiveBytes: storage.archive.bytes, alertLevel: storage.alertLevel, thresholds: storage.thresholds }
        : null,
      health,
      alerts,
      recent: history?.recent ?? [],
      generatedAt: new Date().toISOString(),
    };
  }

  // ───────────────────────── Exceptions console (Module 5) ─────────────────────────

  /** RUNNING jobs older than this (and no completedAt) are flagged as a heuristic. */
  private static readonly STALE_MS = 60 * 60 * 1000; // 1 hour

  /** Batched study→MRN+modality lookup for a set of job UIDs (org already filtered). */
  private async mrnLookup(uids: string[], seePatient: boolean): Promise<Map<string, { mrn: string | null; modality: string | null }>> {
    const map = new Map<string, { mrn: string | null; modality: string | null }>();
    const list = [...new Set(uids.filter(Boolean))];
    if (list.length === 0) return map;
    const studies = await this.prisma.study.findMany({
      where: { studyInstanceUid: { in: list } },
      select: { studyInstanceUid: true, modality: true, patient: { select: { mrn: true } } },
    });
    for (const s of studies) {
      map.set(s.studyInstanceUid, { mrn: seePatient ? (s.patient?.mrn ?? null) : null, modality: s.modality ?? null });
    }
    return map;
  }

  /**
   * Consolidated, READ-ONLY operational exceptions (C). Never mutates a job. Each
   * row is classified:
   *  - CONFIRMED      → an explicitly recorded FAILED / PARTIALLY_COMPLETED status.
   *  - HEURISTIC      → inferred interrupted (RUNNING, startedAt past STALE_MS, no
   *                     completedAt). Clearly separated; status is NOT reported as FAILED.
   *  - INFRASTRUCTURE → an open storage threshold alert or an unhealthy service.
   * Recovery references ONLY existing endpoints + their existing permission; this
   * service performs no recovery itself. Per-source RBAC + org isolation + patient
   * gating throughout. No file paths / credentials / infra secrets are emitted.
   */
  async exceptions(u: AuthUser) {
    const canAny =
      this.canTransfer(u) || this.canArchive(u) || this.canStorage(u) ||
      this.canHealth(u) || this.canAlerts(u);
    if (!canAny) {
      throw new ForbiddenException(
        'Requires one of: pacs.reverse-push.view, pacs.archive.view, pacs.storage.view, system.health.view, system.alert.view',
      );
    }

    const seePatient = u.isSuperAdmin || u.permissions.includes(PERMISSIONS.PATIENT_VIEW);
    const canRpManage = u.isSuperAdmin || u.permissions.includes(PERMISSIONS.PACS_REVERSE_PUSH_MANAGE);
    const canArManage = u.isSuperAdmin || u.permissions.includes(PERMISSIONS.PACS_ARCHIVE_MANAGE);
    const canAlertAck = u.isSuperAdmin || u.permissions.includes(PERMISSIONS.SYSTEM_ALERT_ACK);
    const org = orgScope(u);
    const staleBefore = new Date(Date.now() - OperationalIntegrationService.STALE_MS);

    const rows: any[] = [];

    // ── Reverse-push exceptions (CONFIRMED failed/partial + HEURISTIC interrupted) ──
    if (this.canTransfer(u)) {
      const jobs = await this.prisma.dicomTransferJob.findMany({
        where: {
          ...org,
          OR: [
            { status: { in: ['FAILED', 'PARTIALLY_COMPLETED'] } },
            { status: 'RUNNING', startedAt: { lt: staleBefore }, completedAt: null },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      const lk = await this.mrnLookup(jobs.map((j) => j.studyInstanceUid), seePatient);
      for (const j of jobs) {
        const interrupted = j.status === 'RUNNING';
        const partial = j.status === 'PARTIALLY_COMPLETED';
        const s = lk.get(j.studyInstanceUid) ?? { mrn: null, modality: null };
        rows.push({
          source: 'REVERSE_PUSH',
          id: j.id,
          kind: interrupted ? 'TRANSFER_INTERRUPTED_HEURISTIC' : partial ? 'TRANSFER_PARTIAL' : 'TRANSFER_FAILED',
          classification: interrupted ? 'HEURISTIC' : 'CONFIRMED',
          status: j.status,
          studyInstanceUid: j.studyInstanceUid,
          patientMrn: s.mrn,
          modality: s.modality,
          errorDetail: interrupted
            ? `No progress since ${j.startedAt?.toISOString()} (still RUNNING; inferred interrupted, not confirmed failed)`
            : (j.lastError ?? (partial ? `${j.failedInstances}/${j.totalInstances} instances failed` : 'transfer failed')),
          failedInstances: j.failedInstances,
          totalInstances: j.totalInstances,
          timestamp: (j.completedAt ?? j.startedAt ?? j.createdAt).toISOString(),
          // Recovery via EXISTING reverse-push endpoints; retry only for confirmed failures/partials.
          recovery: interrupted
            ? { action: 'cancel', endpoint: `/api/pacs/reverse-push/jobs/${j.id}/cancel`, requiredPermission: PERMISSIONS.PACS_REVERSE_PUSH_MANAGE }
            : { action: 'retry', endpoint: `/api/pacs/reverse-push/jobs/${j.id}/retry`, requiredPermission: PERMISSIONS.PACS_REVERSE_PUSH_MANAGE },
          canRecover: canRpManage,
        });
      }
    }

    // ── Archive exceptions (CONFIRMED failed) ──
    if (this.canArchive(u)) {
      const jobs = await this.prisma.archiveJob.findMany({
        where: { ...org, status: 'FAILED' },
        orderBy: { createdAt: 'desc' },
      });
      const lk = await this.mrnLookup(jobs.map((j) => j.studyInstanceUid), seePatient);
      for (const j of jobs) {
        const s = lk.get(j.studyInstanceUid) ?? { mrn: null, modality: null };
        rows.push({
          source: 'ARCHIVE',
          id: j.id,
          kind: 'ARCHIVE_FAILED',
          classification: 'CONFIRMED',
          status: j.status,
          studyInstanceUid: j.studyInstanceUid,
          patientMrn: s.mrn,
          modality: s.modality,
          // error message only (never archivePath / disk paths).
          errorDetail: (j.error ? String(j.error).slice(0, 200) : 'archive failed'),
          timestamp: (j.completedAt ?? j.startedAt ?? j.createdAt).toISOString(),
          recovery: { action: 'verify', endpoint: `/api/pacs/archive/jobs/${j.id}/verify`, requiredPermission: PERMISSIONS.PACS_ARCHIVE_MANAGE },
          canRecover: canArManage,
        });
      }
    }

    // ── Infrastructure: open storage threshold alerts ──
    if (this.canAlerts(u)) {
      const alertPage: any = await this.alerts.list(u, { status: 'OPEN', pageSize: 100, page: 1 });
      for (const a of alertPage.data ?? []) {
        // storage threshold alerts (source THRESHOLD/STORAGE); other open alerts included as infra too.
        rows.push({
          source: 'INFRA_ALERT',
          id: a.id,
          kind: a.source === 'STORAGE' || a.source === 'THRESHOLD' ? 'STORAGE_ALERT' : 'SYSTEM_ALERT',
          classification: 'INFRASTRUCTURE',
          status: a.status,
          level: a.level,
          errorDetail: a.title,
          timestamp: new Date(a.createdAt).toISOString(),
          recovery: { action: 'acknowledge', endpoint: `/api/system/alerts/${a.id}/acknowledge`, requiredPermission: PERMISSIONS.SYSTEM_ALERT_ACK },
          canRecover: canAlertAck,
        });
      }
    }

    // ── Infrastructure: unhealthy services ──
    if (this.canHealth(u)) {
      const svcs = await this.health.latest();
      for (const h of svcs) {
        if (h.status !== 'HEALTHY' && h.status !== 'UNKNOWN') {
          rows.push({
            source: 'INFRA_SERVICE',
            id: `service:${h.service}`,
            kind: 'SERVICE_UNHEALTHY',
            classification: 'INFRASTRUCTURE',
            status: h.status,
            service: h.service,
            errorDetail: h.detail ?? `${h.service} is ${h.status}`,
            timestamp: (h.lastFailureAt ? new Date(h.lastFailureAt) : new Date()).toISOString(),
            recovery: null, // no safe automated recovery for a down service
            canRecover: false,
          });
        }
      }
    }

    // newest first
    rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    await this.audit.log({
      userId: u.id, action: 'OPS_INTEGRATION_EXCEPTIONS_VIEW',
      detail: { count: rows.length },
    });

    return {
      data: rows,
      counts: {
        confirmed: rows.filter((r) => r.classification === 'CONFIRMED').length,
        heuristic: rows.filter((r) => r.classification === 'HEURISTIC').length,
        infrastructure: rows.filter((r) => r.classification === 'INFRASTRUCTURE').length,
        total: rows.length,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
