import { Controller, Get, Post, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { HealthService } from './health.service';
import { MetricsService } from './metrics.service';
import { AlertsService } from './alerts.service';
import { SupervisorService } from './supervisor.service';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { paginate, skipTake } from '../common/pagination';

@Controller('system')
export class OpsController {
  constructor(
    private health: HealthService,
    private metrics: MetricsService,
    private alerts: AlertsService,
    private prisma: PrismaService,
    private supervisor: SupervisorService,
  ) {}

  // All-in-one image only (deploy/allinone) — returns { available: false }
  // on the dev Compose stack, which has no supervisord.
  @Get('process-status')
  @RequirePermissions(PERMISSIONS.SYSTEM_HEALTH_VIEW)
  processStatus() {
    return this.supervisor.getProcessStatus();
  }

  // ---- health ----
  @Get('health-status')
  @RequirePermissions(PERMISSIONS.SYSTEM_HEALTH_VIEW)
  async healthStatus(@Query('fresh') fresh?: string) {
    return fresh === 'true' ? this.health.checkAll(true) : this.health.latest();
  }

  // ---- dashboard metrics ----
  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.SYSTEM_DASHBOARD_VIEW)
  dashboard(@CurrentUser() user: AuthUser) {
    return this.metrics.dashboard(user);
  }

  // ---- alerts ----
  @Get('alerts')
  @RequirePermissions(PERMISSIONS.SYSTEM_ALERT_VIEW)
  alertsList(@CurrentUser() user: AuthUser, @Query() q: any) {
    q.page = q.page ? Number(q.page) : 1;
    q.pageSize = q.pageSize ? Math.min(Number(q.pageSize), 100) : 25;
    return this.alerts.list(user, q);
  }

  @Get('alerts/summary')
  @RequirePermissions(PERMISSIONS.SYSTEM_ALERT_VIEW)
  alertsSummary(@CurrentUser() user: AuthUser) {
    return this.alerts.openCount(user);
  }

  @Post('alerts/:id/acknowledge')
  @RequirePermissions(PERMISSIONS.SYSTEM_ALERT_ACK)
  ack(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.alerts.acknowledge(user, id, req.ip);
  }

  @Post('alerts/:id/resolve')
  @RequirePermissions(PERMISSIONS.SYSTEM_ALERT_RESOLVE)
  resolve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.alerts.resolve(user, id, req.ip);
  }

  // ---- background jobs ----
  @Get('jobs')
  @RequirePermissions(PERMISSIONS.SYSTEM_JOBS_VIEW)
  async jobs(@Query() q: any) {
    q.page = q.page ? Number(q.page) : 1;
    q.pageSize = q.pageSize ? Math.min(Number(q.pageSize), 100) : 25;
    const where: any = {};
    if (q.jobType) where.jobType = q.jobType;
    if (q.status) where.status = q.status;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.backgroundJobRecord.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.backgroundJobRecord.count({ where }),
    ]);
    return paginate(rows, total, q);
  }
}
