import { Controller, Get, Post, Param, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { OperationsHistoryService } from './operations-history.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

/**
 * PACS Operations Module 4 — Transfer & Archive History (read-only).
 * No @RequirePermissions at the route level: these endpoints need EITHER
 * pacs.reverse-push.view OR pacs.archive.view (OR semantics), which the
 * global PermissionsGuard can't express (it is AND-combined). The OR gate +
 * per-source filtering + patient gating are enforced in the service. The
 * global JwtAuthGuard still requires authentication on every route.
 */
@Controller('pacs/operations/history')
export class OperationsHistoryController {
  constructor(private svc: OperationsHistoryService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() u: AuthUser, @Query() q: any) { return this.svc.dashboard(u, q); }

  @Get('list')
  list(@CurrentUser() u: AuthUser, @Query() q: any) { return this.svc.list(u, q); }

  @Get('reverse-push')
  listReversePush(@CurrentUser() u: AuthUser, @Query() q: any) { return this.svc.listReversePush(u, q); }

  @Get('archive')
  listArchive(@CurrentUser() u: AuthUser, @Query() q: any) { return this.svc.listArchive(u, q); }

  // NOTE: '/export' is declared before '/reverse-push/:jobId' etc.; distinct paths so no capture risk.
  @Get('export')
  async export(@CurrentUser() u: AuthUser, @Query() q: any, @Req() req: Request, @Res() res: Response) {
    const kind = (q.kind as string) || 'unified';
    const csv = await this.svc.exportCsv(u, kind, q, req.ip);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ops-history-${kind}-${Date.now()}.csv"`);
    res.send(csv);
  }

  // Per-study operational aggregate (Module 5). Distinct literal 'study/' prefix,
  // so no capture conflict with reverse-push/:jobId or archive/:jobId.
  @Get('study/:uid')
  studyOperations(@CurrentUser() u: AuthUser, @Param('uid') uid: string) { return this.svc.studyOperations(u, uid); }

  @Get('reverse-push/:jobId')
  reversePushDetail(@CurrentUser() u: AuthUser, @Param('jobId') jobId: string) { return this.svc.reversePushDetail(u, jobId); }

  @Get('archive/:jobId')
  archiveDetail(@CurrentUser() u: AuthUser, @Param('jobId') jobId: string) { return this.svc.archiveDetail(u, jobId); }

  @Post('archive/:jobId/verify')
  reverify(@CurrentUser() u: AuthUser, @Param('jobId') jobId: string, @Req() r: Request) { return this.svc.reverifyArchive(u, jobId, r.ip); }
}
