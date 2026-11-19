import { Controller, Get, Post, Patch, Body, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { IsOptional, IsObject } from 'class-validator';
import { StorageService } from './storage.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';

class StorageConfigDto { @IsOptional() @IsObject() thresholds?: { info?: number; warning?: number; high?: number; critical?: number }; }

@Controller('pacs/storage')
export class StorageController {
  constructor(private svc: StorageService) {}

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.PACS_STORAGE_VIEW)
  dashboard(@CurrentUser() u: AuthUser) { return this.svc.dashboard(u); }

  @Get('config')
  @RequirePermissions(PERMISSIONS.PACS_STORAGE_VIEW)
  getConfig(@CurrentUser() u: AuthUser) { return this.svc.getConfig(u); }

  @Patch('config')
  @RequirePermissions(PERMISSIONS.PACS_STORAGE_MANAGE)
  setConfig(@CurrentUser() u: AuthUser, @Body() dto: StorageConfigDto, @Req() r: Request) { return this.svc.setConfig(u, dto, r.ip); }

  @Get('growth')
  @RequirePermissions(PERMISSIONS.PACS_STORAGE_VIEW)
  growth() { return this.svc.growth(); }

  @Get('history')
  @RequirePermissions(PERMISSIONS.PACS_STORAGE_VIEW)
  history(@CurrentUser() u: AuthUser, @Query() q: any) {
    q.page = q.page ? Number(q.page) : 1; q.pageSize = q.pageSize ? Math.min(Number(q.pageSize), 200) : 50;
    return this.svc.history(u, q);
  }

  @Get('history/export')
  @RequirePermissions(PERMISSIONS.PACS_STORAGE_VIEW)
  async export(@CurrentUser() u: AuthUser, @Req() req: Request, @Res() res: Response) {
    const csv = await this.svc.exportCsv(u, req.ip);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="storage-history-${Date.now()}.csv"`);
    res.send(csv);
  }

  @Post('snapshot')
  @RequirePermissions(PERMISSIONS.PACS_STORAGE_MANAGE)
  snapshot(@CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.triggerSnapshot(u, r.ip); }
}
