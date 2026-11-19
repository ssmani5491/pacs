import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../auth/current-user.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Report lifecycle engine (Phase 7).
 *
 * States:  DRAFT → PRELIMINARY → FINAL   (+ ADDENDUM reports linked to a FINAL)
 * Rules (server-enforced):
 *  - Only the content fields may change while DRAFT/PRELIMINARY.
 *  - Each content change writes a ReportVersion snapshot (version history).
 *  - FINAL requires finalize permission; SIGN requires sign permission + password
 *    step-up re-auth; signing locks the report.
 *  - A locked/FINAL report is immutable: no edits, no re-sign, no delete.
 *  - Corrections after FINAL are done via a linked ADDENDUM report; the original
 *    stays byte-for-byte unchanged.
 *  - Organization isolation on every read/write (super admin bypasses).
 */
@Injectable()
export class ReportsService {
  private readonly log = new Logger('ReportsService');

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private auth: AuthService,
    private notifications: NotificationsService,
  ) {}

  /** Raise a reporting notification (non-fatal; never blocks the lifecycle). */
  private async notify(report: any, category: string, title: string, priority: 'NORMAL' | 'HIGH' = 'NORMAL') {
    await this.notifications.create({
      category, priority, roleKey: 'radiologist',
      organizationId: report.organizationId, studyId: report.studyId, reportId: report.id,
      dedupKey: `${category}:${report.id}:${report.version}`,
      title, body: title, link: `/reports/study/${report.studyId}`,
    });
  }

  private can(user: AuthUser, perm: string) {
    return user.isSuperAdmin || user.permissions.includes(perm);
  }
  private require(user: AuthUser, perm: string) {
    if (!this.can(user, perm)) throw new ForbiddenException(`Missing permission: ${perm}`);
  }

  /** Enforce org isolation: the study/report must be in the user's org. */
  private assertOrg(user: AuthUser, orgId?: string | null) {
    if (user.isSuperAdmin) return;
    if (!orgId || orgId !== user.organizationId) {
      throw new ForbiddenException('Resource belongs to another organization');
    }
  }

  /** Content snapshot used for versioning + signature hashing. */
  private contentOf(r: any) {
    return {
      clinicalHistory: r.clinicalHistory ?? null,
      technique: r.technique ?? null,
      comparison: r.comparison ?? null,
      findings: r.findings ?? null,
      impression: r.impression ?? null,
      recommendations: r.recommendations ?? null,
    };
  }

  /** Allocate the next monotonic snapshot version number for a report, so every
   * ReportVersion row (content edit OR status transition) is unique and ordered. */
  private async nextSnapshotVersion(tx: any, reportId: string): Promise<number> {
    const last = await tx.reportVersion.findFirst({
      where: { reportId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (last?.version ?? 0) + 1;
  }

  private hashContent(report: any, signerId: string, when: Date, version: number) {
    const payload = JSON.stringify({
      reportId: report.id,
      content: this.contentOf(report),
      signerId,
      signedAt: when.toISOString(),
      version,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  // ───────────────────────────── reads ─────────────────────────────

  async getById(user: AuthUser, id: string) {
    this.require(user, PERMISSIONS.REPORT_VIEW);
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: {
        study: { include: { patient: true } },
        template: true,
        author: { select: { id: true, fullName: true, username: true, designation: true } },
        signatures: { include: { user: { select: { fullName: true, username: true } } }, orderBy: { signedAt: 'asc' } },
        addenda: { include: { author: { select: { fullName: true } }, signatures: true }, orderBy: { createdAt: 'asc' } },
        parent: true,
      },
    });
    if (!report) throw new NotFoundException('Report not found');
    this.assertOrg(user, report.organizationId ?? report.study?.organizationId);
    return report;
  }

  async versions(user: AuthUser, id: string) {
    const report = await this.getById(user, id);
    return this.prisma.reportVersion.findMany({
      where: { reportId: report.id },
      orderBy: { version: 'asc' },
    });
  }

  /** Find or lazily describe the report for a study (one MAIN report per study). */
  async getForStudy(user: AuthUser, studyId: string) {
    this.require(user, PERMISSIONS.REPORT_VIEW);
    const study = await this.prisma.study.findUnique({ where: { id: studyId }, include: { patient: true } });
    if (!study) throw new NotFoundException('Study not found');
    this.assertOrg(user, study.organizationId);
    const report = await this.prisma.report.findFirst({
      where: { studyId, reportType: 'MAIN' },
      include: {
        template: true,
        author: { select: { fullName: true, username: true } },
        signatures: { include: { user: { select: { fullName: true, username: true } } } },
        addenda: { orderBy: { createdAt: 'asc' } },
      },
    });
    return { study, report };
  }

  // ───────────────────────────── create / edit ─────────────────────────────

  /** Create the MAIN report for a study (idempotent: returns existing if present). */
  async create(user: AuthUser, dto: { studyId: string; templateId?: string }, ip?: string) {
    this.require(user, PERMISSIONS.REPORT_CREATE);
    const study = await this.prisma.study.findUnique({ where: { id: dto.studyId } });
    if (!study) throw new NotFoundException('Study not found');
    this.assertOrg(user, study.organizationId);

    const existing = await this.prisma.report.findFirst({
      where: { studyId: dto.studyId, reportType: 'MAIN' },
    });
    if (existing) return existing;

    let seed: any = {};
    if (dto.templateId) {
      const tpl = await this.prisma.reportTemplate.findUnique({ where: { id: dto.templateId } });
      if (tpl) {
        seed = {
          templateId: tpl.id,
          technique: tpl.technique ?? undefined,
          findings: tpl.bodyFindings ?? undefined,
          impression: tpl.bodyImpression ?? undefined,
          recommendations: tpl.bodyRecommendations ?? undefined,
        };
      }
    }

    const report = await this.prisma.$transaction(async (tx) => {
      const r = await tx.report.create({
        data: {
          studyId: study.id,
          organizationId: study.organizationId,
          authorUserId: user.id,
          status: 'DRAFT',
          reportType: 'MAIN',
          version: 1,
          ...seed,
        },
      });
      await tx.reportVersion.create({
        data: { reportId: r.id, version: 1, status: 'DRAFT', snapshot: this.contentOf(r) as any, createdBy: user.id, reason: 'created' },
      });
      return r;
    });
    await this.audit.log({ userId: user.id, action: 'REPORT_CREATE', entityType: 'Report', entityId: report.id, ip });
    return report;
  }

  /** Edit content (only while DRAFT or PRELIMINARY). Writes a new version snapshot. */
  async update(
    user: AuthUser,
    id: string,
    dto: Partial<{ clinicalHistory: string; technique: string; comparison: string; findings: string; impression: string; recommendations: string; templateId: string; reason: string }>,
    ip?: string,
  ) {
    this.require(user, PERMISSIONS.REPORT_EDIT);
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    this.assertOrg(user, report.organizationId);
    if (report.locked || report.status === 'FINAL') {
      throw new ConflictException('Report is finalized and immutable; create an addendum instead');
    }
    if (!['DRAFT', 'PRELIMINARY'].includes(report.status)) {
      throw new ConflictException(`Cannot edit a report in status ${report.status}`);
    }

    const data: any = {};
    for (const k of ['clinicalHistory', 'technique', 'comparison', 'findings', 'impression', 'recommendations', 'templateId'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    if (Object.keys(data).length === 0) return report;

    const updated = await this.prisma.$transaction(async (tx) => {
      const v = await this.nextSnapshotVersion(tx, id);
      const r = await tx.report.update({ where: { id }, data: { ...data, version: report.version + 1 } });
      await tx.reportVersion.create({
        data: { reportId: id, version: v, status: r.status, snapshot: this.contentOf(r) as any, createdBy: user.id, reason: dto.reason ?? 'edit' },
      });
      return r;
    });
    await this.audit.log({ userId: user.id, action: 'REPORT_UPDATE', entityType: 'Report', entityId: id, detail: { fields: Object.keys(data) }, ip });
    return updated;
  }

  // ───────────────────────────── lifecycle transitions ─────────────────────────────

  async submitPreliminary(user: AuthUser, id: string, ip?: string) {
    this.require(user, PERMISSIONS.REPORT_PRELIMINARY);
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    this.assertOrg(user, report.organizationId);
    if (report.status !== 'DRAFT') throw new ConflictException(`Only a DRAFT can be submitted preliminary (current: ${report.status})`);

    const r = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.report.update({ where: { id }, data: { status: 'PRELIMINARY', preliminaryAt: new Date() } });
      const v = await this.nextSnapshotVersion(tx, id);
      await tx.reportVersion.create({ data: { reportId: id, version: v, status: 'PRELIMINARY', snapshot: this.contentOf(updated) as any, createdBy: user.id, reason: 'submit preliminary' } });
      return updated;
    });
    await this.audit.log({ userId: user.id, action: 'REPORT_PRELIMINARY', entityType: 'Report', entityId: id, ip });
    await this.notify(r, 'REPORT_PRELIMINARY', 'Preliminary report saved');
    return r;
  }

  async finalize(user: AuthUser, id: string, ip?: string) {
    this.require(user, PERMISSIONS.REPORT_FINALIZE);
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    this.assertOrg(user, report.organizationId);
    if (!['DRAFT', 'PRELIMINARY'].includes(report.status)) {
      throw new ConflictException(`Cannot finalize a report in status ${report.status}`);
    }
    if (!report.findings && !report.impression) {
      throw new BadRequestException('A report needs findings or an impression before finalizing');
    }

    const r = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.report.update({ where: { id }, data: { status: 'FINAL', finalizedAt: new Date() } });
      const v = await this.nextSnapshotVersion(tx, id);
      await tx.reportVersion.create({ data: { reportId: id, version: v, status: 'FINAL', snapshot: this.contentOf(updated) as any, createdBy: user.id, reason: 'finalize' } });
      return updated;
    });
    await this.audit.log({ userId: user.id, action: 'REPORT_FINALIZE', entityType: 'Report', entityId: id, ip });
    await this.notify(r, 'REPORT_FINAL', 'Report finalized');
    return r;
  }

  /**
   * Sign a FINAL report. Requires step-up re-authentication (password) and the
   * sign permission. Records signer identity, SERVER timestamp, report version,
   * and a SHA-256 signatureHash over content+signer+time+version, then LOCKS the
   * report. This is an authenticated electronic approval — NOT a legally
   * recognised digital signature.
   */
  async sign(user: AuthUser, id: string, password: string, ip?: string) {
    this.require(user, PERMISSIONS.REPORT_SIGN);
    if (!password) throw new BadRequestException('Password is required to sign');

    // Step-up re-auth.
    const ok = await this.auth.verifyUserPassword(user.id, password);
    if (!ok) {
      await this.audit.log({ userId: user.id, action: 'REPORT_SIGN_REAUTH_FAILED', entityType: 'Report', entityId: id, ip });
      throw new UnauthorizedException('Re-authentication failed');
    }

    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    this.assertOrg(user, report.organizationId);
    if (report.status !== 'FINAL') throw new ConflictException('Only a FINAL report can be signed');
    if (report.locked) throw new ConflictException('Report is already signed and locked');

    const now = new Date(); // server time (never client-supplied)
    const hash = this.hashContent(report, user.id, now, report.version);

    const signed = await this.prisma.$transaction(async (tx) => {
      const sig = await tx.reportSignature.create({
        data: {
          reportId: id,
          userId: user.id,
          signedAt: now,
          signatureHash: hash,
          reportVersion: report.version,
          method: 'ELECTRONIC_APPROVAL',
          verification: `SHA-256 over report content + signer + server time + v${report.version}`,
          kind: report.reportType === 'ADDENDUM' ? 'ADDENDUM' : 'FINAL',
        },
      });
      const updated = await tx.report.update({ where: { id }, data: { locked: true, signedAt: now } });
      return { updated, sig };
    });
    await this.audit.log({
      userId: user.id, action: 'REPORT_SIGN', entityType: 'Report', entityId: id,
      detail: { signatureHash: hash, version: report.version }, ip,
    });
    await this.notify(signed.updated, 'REPORT_SIGNED', 'Report signed', 'NORMAL');
    return signed;
  }

  // ───────────────────────────── addendum ─────────────────────────────

  /**
   * Create a controlled addendum to a signed FINAL report. The original stays
   * untouched; the addendum is its own Report row (reportType ADDENDUM) linked
   * via parentReportId, starting in DRAFT.
   */
  async createAddendum(user: AuthUser, parentId: string, dto: { reason: string; findings?: string; impression?: string; recommendations?: string }, ip?: string) {
    this.require(user, PERMISSIONS.REPORT_AMEND);
    if (!dto.reason) throw new BadRequestException('An addendum requires a reason');
    const parent = await this.prisma.report.findUnique({ where: { id: parentId } });
    if (!parent) throw new NotFoundException('Original report not found');
    this.assertOrg(user, parent.organizationId);
    if (parent.status !== 'FINAL' || !parent.locked) {
      throw new ConflictException('Addenda can only be added to a signed FINAL report');
    }

    const addendum = await this.prisma.$transaction(async (tx) => {
      const a = await tx.report.create({
        data: {
          studyId: parent.studyId,
          organizationId: parent.organizationId,
          authorUserId: user.id,
          status: 'DRAFT',
          reportType: 'ADDENDUM',
          parentReportId: parent.id,
          version: 1,
          findings: dto.findings,
          impression: dto.impression,
          recommendations: dto.recommendations,
        },
      });
      await tx.reportVersion.create({ data: { reportId: a.id, version: 1, status: 'DRAFT', snapshot: this.contentOf(a) as any, createdBy: user.id, reason: dto.reason } });
      // mark the parent as having an addendum (status stays FINAL + locked; content unchanged)
      return a;
    });
    await this.audit.log({ userId: user.id, action: 'REPORT_ADDENDUM_CREATE', entityType: 'Report', entityId: addendum.id, detail: { parentId, reason: dto.reason }, ip });
    await this.notify(addendum, 'REPORT_ADDENDUM', 'Report addendum created', 'HIGH');
    return addendum;
  }
}
