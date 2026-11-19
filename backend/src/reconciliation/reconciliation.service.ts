import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';
import { orgScope } from '../common/tenant';
import { PaginationQuery, paginate, skipTake } from '../common/pagination';

@Injectable()
export class ReconciliationService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // Unmatched / orphan studies awaiting manual reconciliation.
  async unmatched(user: AuthUser, q: PaginationQuery) {
    const where: any = { isReconciled: false };
    // orphans may have no org; super sees all, org users see their org + null-org orphans
    if (!user.isSuperAdmin) where.OR = [{ organizationId: user.organizationId }, { organizationId: null }];
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.study.findMany({
        where, orderBy: { createdAt: 'desc' }, ...skipTake(q),
        include: { patient: { select: { mrn: true, name: true } } },
      }),
      this.prisma.study.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  /** Attach an orphan study to an existing patient (and optionally an order/accession). */
  async reconcile(user: AuthUser, studyId: string, patientId: string, accessionNumber?: string, ip?: string) {
    const study = await this.prisma.study.findUnique({ where: { id: studyId } });
    if (!study) throw new NotFoundException('Study not found');
    const patient = await this.prisma.patient.findFirst({ where: { id: patientId, ...orgScope(user) } });
    if (!patient) throw new NotFoundException('Target patient not found or out of scope');

    const data: any = {
      patientId, organizationId: patient.organizationId,
      isOrphan: false, isReconciled: true,
    };
    if (accessionNumber) {
      const order = await this.prisma.scheduledOrder.findUnique({ where: { accessionNumber } });
      if (order) {
        data.accessionNumber = accessionNumber;
        await this.prisma.scheduledOrder.update({
          where: { id: order.id }, data: { status: 'COMPLETED', studyId, studyInstanceUid: study.studyInstanceUid },
        });
      }
    }
    const updated = await this.prisma.study.update({ where: { id: studyId }, data });
    await this.audit.log({
      userId: user.id, action: 'STUDY_RECONCILE', entityType: 'Study', entityId: studyId,
      detail: { patientId, accessionNumber }, ip,
    });
    return updated;
  }

  // Potential duplicate studies: same StudyInstanceUID appearing more than once
  // shouldn't happen (unique), but detect same accession across different UIDs.
  async duplicates(user: AuthUser) {
    const rows = await this.prisma.study.groupBy({
      by: ['accessionNumber'],
      where: { ...orgScope(user), accessionNumber: { not: null } },
      _count: { _all: true },
      having: { accessionNumber: { _count: { gt: 1 } } },
    });
    return rows.map((r) => ({ accessionNumber: r.accessionNumber, count: r._count._all }));
  }
}
