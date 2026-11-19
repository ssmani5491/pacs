import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { orgScope, orgSelfScope } from '../common/tenant';

@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(private prisma: PrismaService) {}

  // Administration dashboard counts — all from real DB, org-scoped.
  @Get('dashboard')
  async dashboard(@CurrentUser() user: AuthUser) {
    const scope = orgScope(user);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayScope = { ...scope, registrationDate: { gte: startOfToday } };
    const todayStudyScope = { ...scope, createdAt: { gte: startOfToday } };

    const [
      organizations, departments, doctors, users, modalities, activeModalities,
      patients, patientsToday, orders, ordersToday, studies,
      ready, draft, preliminary, final, cancelled,
    ] = await this.prisma.$transaction([
      this.prisma.organization.count({ where: orgSelfScope(user) }),
      this.prisma.department.count({ where: scope }),
      this.prisma.doctor.count({ where: scope }),
      this.prisma.user.count({ where: scope }),
      this.prisma.modalityDevice.count({ where: scope }),
      this.prisma.modalityDevice.count({ where: { ...scope, active: true } }),
      this.prisma.patient.count({ where: { ...scope, status: { not: 'MERGED' } } }),
      this.prisma.patient.count({ where: todayScope }),
      this.prisma.scheduledOrder.count({ where: scope }),
      this.prisma.scheduledOrder.count({ where: { ...scope, createdAt: { gte: startOfToday } } }),
      this.prisma.study.count({ where: scope }),
      this.prisma.study.count({ where: { ...scope, reportStatus: 'READY' } }),
      this.prisma.study.count({ where: { ...scope, reportStatus: 'DRAFT' } }),
      this.prisma.study.count({ where: { ...scope, reportStatus: 'PRELIMINARY' } }),
      this.prisma.study.count({ where: { ...scope, reportStatus: 'FINAL' } }),
      this.prisma.study.count({ where: { ...scope, reportStatus: 'CANCELLED' } }),
    ]);

    // modality-wise breakdown
    const byModality = await this.prisma.study.groupBy({
      by: ['modality'], where: scope, _count: { _all: true },
    });

    return {
      // Phase 2 (preserved)
      organizations, departments, doctors, users, modalities, activeModalities,
      // Phase 3 clinical
      patients, patientsToday, orders, ordersToday, studies,
      reports: { ready, draft, preliminary, final, cancelled },
      pendingStudies: ready + draft,
      readyForReporting: ready,
      modalityStats: byModality
        .filter((m) => m.modality)
        .map((m) => ({ modality: m.modality, count: m._count._all })),
      generatedAt: new Date().toISOString(),
    };
  }
}
