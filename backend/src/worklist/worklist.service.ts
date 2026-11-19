import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';
import { paginate, buildOrderBy, skipTake } from '../common/pagination';
import { orgScope } from '../common/tenant';
import { WorklistQuery } from './dto';

const SORTABLE = ['studyDate', 'accessionNumber', 'modality', 'reportStatus', 'createdAt'];

@Injectable()
export class WorklistService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private buildWhere(user: AuthUser, q: WorklistQuery) {
    const where: any = { ...orgScope(user) };

    // status tab -> reportStatus (PENDING = READY + no report yet; here ~ READY/DRAFT)
    if (q.status && q.status !== 'ALL') {
      if (q.status === 'PENDING') where.reportStatus = { in: ['READY', 'DRAFT'] };
      else where.reportStatus = q.status;
    }
    if (q.modality) {
      const mods = q.modality.split(',').map((m) => m.trim()).filter(Boolean);
      if (mods.length) where.modality = { in: mods };
    }
    if (q.accession) where.accessionNumber = { contains: q.accession, mode: 'insensitive' };
    if (q.referringDoctorId) where.referringDoctorId = q.referringDoctorId;
    if (q.assignedUserId) where.assignedUserId = q.assignedUserId;
    if (q.myAssignment === 'true') where.assignedUserId = user.id;

    if (q.dateFrom || q.dateTo) {
      where.studyDate = {};
      if (q.dateFrom) where.studyDate.gte = new Date(q.dateFrom);
      if (q.dateTo) { const d = new Date(q.dateTo); d.setHours(23, 59, 59, 999); where.studyDate.lte = d; }
    }

    // patient filters via relation
    const patientWhere: any = {};
    if (q.patientId) patientWhere.mrn = { contains: q.patientId, mode: 'insensitive' };
    if (q.patientName) patientWhere.name = { contains: q.patientName, mode: 'insensitive' };
    if (Object.keys(patientWhere).length) where.patient = { is: patientWhere };

    // global search
    if (q.search) {
      where.OR = [
        { accessionNumber: { contains: q.search, mode: 'insensitive' } },
        { description: { contains: q.search, mode: 'insensitive' } },
        { patient: { is: { name: { contains: q.search, mode: 'insensitive' } } } },
        { patient: { is: { mrn: { contains: q.search, mode: 'insensitive' } } } },
      ];
    }
    return where;
  }

  async query(user: AuthUser, q: WorklistQuery) {
    const where = this.buildWhere(user, q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.study.findMany({
        where, orderBy: buildOrderBy(q, SORTABLE, 'studyDate'), ...skipTake(q),
        include: {
          patient: { select: { mrn: true, name: true, gender: true, dob: true } },
          referringDoctor: { select: { name: true } },
          assignments: { include: { user: { select: { id: true, fullName: true } } } },
        },
      }),
      this.prisma.study.count({ where }),
    ]);

    // flatten to worklist row shape
    const data = rows.map((s, i) => ({
      slNo: (q.page - 1) * q.pageSize + i + 1,
      id: s.id,
      patientId: s.patient?.mrn ?? '—',
      patientName: s.patient?.name ?? '—',
      accessionNumber: s.accessionNumber ?? '—',
      studyDate: s.studyDate,
      modality: s.modality ?? '—',
      description: s.description ?? '—',
      referringDoctor: s.referringDoctor?.name ?? '—',
      assignedRadiologist: s.assignments[0]?.user?.fullName ?? null,
      assignedUserId: s.assignedUserId,
      reportStatus: s.reportStatus,
      imageCount: s.imageCount,
      studyInstanceUid: s.studyInstanceUid,
      // true when the study actually exists in Orthanc -> openable in the viewer.
      hasImages: !!s.orthancStudyId,
    }));
    return paginate(data, total, q);
  }

  /** Status-tab counts for the current filter set (minus the status itself). */
  async counts(user: AuthUser, q: WorklistQuery) {
    const base = this.buildWhere(user, { ...q, status: 'ALL' });
    const statuses = ['READY', 'DRAFT', 'PRELIMINARY', 'FINAL', 'CANCELLED'];
    const [all, ...perStatus] = await this.prisma.$transaction([
      this.prisma.study.count({ where: base }),
      ...statuses.map((st) => this.prisma.study.count({ where: { ...base, reportStatus: st } })),
    ]);
    const out: Record<string, number> = { ALL: all };
    statuses.forEach((st, i) => (out[st] = perStatus[i]));
    out.PENDING = (out.READY ?? 0) + (out.DRAFT ?? 0);
    return out;
  }

  async assign(user: AuthUser, studyId: string, userId: string, ip?: string) {
    const study = await this.prisma.study.findFirst({ where: { id: studyId, ...orgScope(user) } });
    if (!study) throw new NotFoundException('Study not found');
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('Target user not found');

    await this.prisma.$transaction([
      this.prisma.studyAssignment.upsert({
        where: { studyId_userId: { studyId, userId } },
        update: { assignedAt: new Date(), assignedBy: user.id },
        create: { studyId, userId, assignedBy: user.id },
      }),
      this.prisma.study.update({ where: { id: studyId }, data: { assignedUserId: userId } }),
    ]);
    await this.audit.log({ userId: user.id, action: 'STUDY_ASSIGN', entityType: 'Study', entityId: studyId, detail: { assignedTo: userId }, ip });
    return { success: true, studyId, userId };
  }

  async assignmentHistory(user: AuthUser, studyId: string) {
    const study = await this.prisma.study.findFirst({ where: { id: studyId, ...orgScope(user) } });
    if (!study) throw new NotFoundException('Study not found');
    return this.prisma.studyAssignment.findMany({
      where: { studyId }, orderBy: { assignedAt: 'desc' },
      include: { user: { select: { fullName: true, username: true } } },
    });
  }

  async pendingAssignment(user: AuthUser, q: WorklistQuery) {
    return this.query(user, { ...q, status: 'READY', assignedUserId: undefined, myAssignment: undefined } as any);
  }
}
