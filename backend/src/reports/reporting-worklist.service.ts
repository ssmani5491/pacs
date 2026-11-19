import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { paginate, skipTake } from '../common/pagination';
import { orgScope } from '../common/tenant';

/**
 * Reporting worklist / dashboard (Phase 7, Module 4).
 *
 * Buckets studies by their MAIN report's lifecycle status:
 *   UNREPORTED  — no report yet (ready for reporting)
 *   DRAFT / PRELIMINARY / FINAL — by report status
 *   ADDENDUM    — final reports that have at least one addendum
 * Plus filters (patient, accession, modality, date, assigned radiologist).
 */
@Injectable()
export class ReportingWorklistService {
  constructor(private prisma: PrismaService) {}

  private studyWhere(user: AuthUser, q: any) {
    const where: any = { ...orgScope(user) };
    if (q.modality) {
      const mods = String(q.modality).split(',').map((m: string) => m.trim()).filter(Boolean);
      if (mods.length) where.modality = { in: mods };
    }
    if (q.accession) where.accessionNumber = { contains: q.accession, mode: 'insensitive' };
    if (q.assignedUserId) where.assignedUserId = q.assignedUserId;
    if (q.myAssignment === 'true') where.assignedUserId = user.id;
    if (q.dateFrom || q.dateTo) {
      where.studyDate = {};
      if (q.dateFrom) where.studyDate.gte = new Date(q.dateFrom);
      if (q.dateTo) { const d = new Date(q.dateTo); d.setHours(23, 59, 59, 999); where.studyDate.lte = d; }
    }
    const patientWhere: any = {};
    if (q.patientId) patientWhere.mrn = { contains: q.patientId, mode: 'insensitive' };
    if (q.patientName) patientWhere.name = { contains: q.patientName, mode: 'insensitive' };
    if (Object.keys(patientWhere).length) where.patient = { is: patientWhere };
    return where;
  }

  /** Translate a report-status bucket into a Prisma relation filter on reports. */
  private bucketFilter(bucket: string): any {
    switch (bucket) {
      case 'UNREPORTED':
        return { reports: { none: { reportType: 'MAIN' } } };
      case 'DRAFT':
      case 'PRELIMINARY':
      case 'FINAL':
        return { reports: { some: { reportType: 'MAIN', status: bucket } } };
      case 'ADDENDUM':
        return { reports: { some: { reportType: 'ADDENDUM' } } };
      default:
        return {}; // ALL
    }
  }

  async list(user: AuthUser, q: any) {
    const where = { ...this.studyWhere(user, q), ...this.bucketFilter(q.bucket ?? 'ALL') };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.study.findMany({
        where,
        orderBy: { studyDate: 'desc' },
        ...skipTake(q),
        include: {
          patient: { select: { mrn: true, name: true } },
          assignments: { include: { user: { select: { fullName: true } } }, take: 1, orderBy: { assignedAt: 'desc' } },
          reports: {
            select: { id: true, status: true, reportType: true, locked: true, version: true, updatedAt: true, authorUserId: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      this.prisma.study.count({ where }),
    ]);

    const data = rows.map((s: any, i: number) => {
      const main = s.reports.find((r: any) => r.reportType === 'MAIN');
      const addenda = s.reports.filter((r: any) => r.reportType === 'ADDENDUM');
      return {
        slNo: (q.page ? (q.page - 1) * (q.pageSize ?? 20) : 0) + i + 1,
        studyId: s.id,
        studyInstanceUid: s.studyInstanceUid,
        patientId: s.patient?.mrn ?? '—',
        patientName: s.patient?.name ?? '—',
        accessionNumber: s.accessionNumber ?? '—',
        modality: s.modality ?? '—',
        description: s.description ?? '—',
        studyDate: s.studyDate,
        imageCount: s.imageCount,
        hasImages: !!s.orthancStudyId,
        assignedRadiologist: s.assignments[0]?.user?.fullName ?? null,
        reportId: main?.id ?? null,
        reportStatus: main ? main.status : 'UNREPORTED',
        reportLocked: main?.locked ?? false,
        reportVersion: main?.version ?? null,
        addendumCount: addenda.length,
      };
    });
    return paginate(data, total, q);
  }

  /** Counts per bucket for the dashboard tabs. */
  async counts(user: AuthUser, q: any) {
    const base = this.studyWhere(user, q);
    const buckets = ['ALL', 'UNREPORTED', 'DRAFT', 'PRELIMINARY', 'FINAL', 'ADDENDUM'];
    const results = await this.prisma.$transaction(
      buckets.map((b) => this.prisma.study.count({ where: { ...base, ...this.bucketFilter(b) } })),
    );
    const out: Record<string, number> = {};
    buckets.forEach((b, i) => (out[b] = results[i]));
    return out;
  }
}
