import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { orgScope } from '../common/tenant';

/**
 * Operational dashboard metrics (Phase 8, Module E). Org-scoped counts from real
 * DB records. Uses indexed count queries in a single transaction to avoid N+1.
 */
@Injectable()
export class MetricsService {
  constructor(private prisma: PrismaService) {}

  async dashboard(user: AuthUser) {
    const scope = orgScope(user); // {} for super admin, { organizationId } otherwise
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);

    const studyWhere = (extra: any = {}) => ({ ...scope, ...extra });
    const reportWhere = (extra: any = {}) => (user.isSuperAdmin ? extra : { organizationId: user.organizationId ?? '__none__', ...extra });

    const [
      studiesToday, studiesMonth, pendingReconciliation, failedReceptions,
      activeModalities, prelimReports, finalReports, signedReports,
    ] = await this.prisma.$transaction([
      this.prisma.study.count({ where: studyWhere({ createdAt: { gte: startOfDay } }) }),
      this.prisma.study.count({ where: studyWhere({ createdAt: { gte: startOfMonth } }) }),
      this.prisma.study.count({ where: studyWhere({ isReconciled: false }) }),
      this.prisma.dicomReceptionLog.count({ where: { status: 'FAILED', createdAt: { gte: startOfMonth } } }),
      this.prisma.modalityDevice.count({ where: user.isSuperAdmin ? { active: true } : { active: true, organizationId: user.organizationId ?? '__none__' } }),
      this.prisma.report.count({ where: reportWhere({ status: 'PRELIMINARY', reportType: 'MAIN' }) }),
      this.prisma.report.count({ where: reportWhere({ status: 'FINAL', reportType: 'MAIN' }) }),
      this.prisma.report.count({ where: reportWhere({ locked: true }) }),
    ]);

    // MWL query activity (today) — not org-scoped (SCP logs are global).
    const mwlToday = await this.prisma.mwlQueryLog.count({ where: { createdAt: { gte: startOfDay } } });

    return {
      studiesToday, studiesMonth, pendingReconciliation, failedReceptions,
      activeModalities, mwlQueriesToday: mwlToday,
      preliminaryReports: prelimReports, finalizedReports: finalReports, signedReports,
      generatedAt: new Date().toISOString(),
    };
  }
}
