import { Controller, Get, Post, Patch, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ReversePushService } from './reverse-push.service';
import { CreateDestinationDto, UpdateDestinationDto, CreateTransferJobDto } from './reverse-push.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';

@Controller('pacs')
export class ReversePushController {
  constructor(private svc: ReversePushService) {}

  // ── destinations ──
  @Get('destinations')
  @RequirePermissions(PERMISSIONS.PACS_REVERSE_PUSH_VIEW)
  listDest(@CurrentUser() u: AuthUser, @Query() q: any) {
    q.page = q.page ? Number(q.page) : 1; q.pageSize = q.pageSize ? Math.min(Number(q.pageSize), 100) : 50;
    return this.svc.listDestinations(u, q);
  }

  @Get('destinations/:id')
  @RequirePermissions(PERMISSIONS.PACS_REVERSE_PUSH_VIEW)
  getDest(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.getDestination(u, id); }

  @Post('destinations')
  @RequirePermissions(PERMISSIONS.PACS_DESTINATION_MANAGE)
  createDest(@CurrentUser() u: AuthUser, @Body() dto: CreateDestinationDto, @Req() r: Request) { return this.svc.createDestination(u, dto, r.ip); }

  @Patch('destinations/:id')
  @RequirePermissions(PERMISSIONS.PACS_DESTINATION_MANAGE)
  updateDest(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateDestinationDto, @Req() r: Request) { return this.svc.updateDestination(u, id, dto, r.ip); }

  @Post('destinations/:id/test')
  @RequirePermissions(PERMISSIONS.PACS_DESTINATION_MANAGE)
  testDest(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() r: Request) { return this.svc.testDestination(u, id, r.ip); }

  // ── reverse push monitor + jobs ──
  @Get('reverse-push/monitor')
  @RequirePermissions(PERMISSIONS.PACS_REVERSE_PUSH_VIEW)
  monitor(@CurrentUser() u: AuthUser) { return this.svc.monitor(u); }

  @Get('reverse-push/jobs')
  @RequirePermissions(PERMISSIONS.PACS_REVERSE_PUSH_VIEW)
  listJobs(@CurrentUser() u: AuthUser, @Query() q: any) {
    q.page = q.page ? Number(q.page) : 1; q.pageSize = q.pageSize ? Math.min(Number(q.pageSize), 100) : 25;
    return this.svc.listJobs(u, q);
  }

  @Get('reverse-push/jobs/:id')
  @RequirePermissions(PERMISSIONS.PACS_REVERSE_PUSH_VIEW)
  getJob(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.getJob(u, id); }

  @Post('reverse-push/jobs')
  @RequirePermissions(PERMISSIONS.PACS_REVERSE_PUSH_MANAGE)
  createJob(@CurrentUser() u: AuthUser, @Body() dto: CreateTransferJobDto, @Req() r: Request) { return this.svc.createJob(u, dto, r.ip); }

  @Post('reverse-push/jobs/:id/pause')
  @RequirePermissions(PERMISSIONS.PACS_REVERSE_PUSH_MANAGE)
  pause(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.pauseJob(u, id); }

  @Post('reverse-push/jobs/:id/resume')
  @RequirePermissions(PERMISSIONS.PACS_REVERSE_PUSH_MANAGE)
  resume(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.resumeJob(u, id); }

  @Post('reverse-push/jobs/:id/cancel')
  @RequirePermissions(PERMISSIONS.PACS_REVERSE_PUSH_MANAGE)
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.cancelJob(u, id); }

  @Post('reverse-push/jobs/:id/retry')
  @RequirePermissions(PERMISSIONS.PACS_REVERSE_PUSH_MANAGE)
  retry(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.retryJob(u, id); }
}
