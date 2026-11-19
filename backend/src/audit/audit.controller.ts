import { Controller, Get, Param, Query, Req, Res, NotFoundException } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuditViewerService } from './audit-viewer.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';

@Controller('audit-logs')
export class AuditController {
  constructor(private svc: AuditViewerService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  list(@CurrentUser() user: AuthUser, @Query() q: any) {
    q.page = q.page ? Number(q.page) : 1;
    q.pageSize = q.pageSize ? Math.min(Number(q.pageSize), 200) : 25;
    return this.svc.list(user, q);
  }

  // NOTE: /export must be declared before /:id so it is not captured as an id.
  @Get('export')
  @RequirePermissions(PERMISSIONS.AUDIT_EXPORT)
  async export(@CurrentUser() user: AuthUser, @Query() q: any, @Req() req: Request, @Res() res: Response) {
    const csv = await this.svc.exportCsv(user, q, req.ip);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-export-${Date.now()}.csv"`);
    res.send(csv);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const r = await this.svc.get(user, id);
    if (!r) throw new NotFoundException('Audit record not found');
    return r;
  }
}
