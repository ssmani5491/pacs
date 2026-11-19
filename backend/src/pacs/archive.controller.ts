import { Controller, Get, Post, Patch, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { IsString, IsOptional, IsInt, IsNotEmpty, MaxLength, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ArchiveService } from './archive.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';

class ArchiveConfigDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(9) compressionLevel?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(8) workerThreads?: number;
}
class CreateArchiveJobDto {
  @IsString() @IsNotEmpty() @MaxLength(128) studyInstanceUid!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(9) compressionLevel?: number;
}

@Controller('pacs/archive')
export class ArchiveController {
  constructor(private svc: ArchiveService) {}

  @Get('config')
  @RequirePermissions(PERMISSIONS.PACS_ARCHIVE_VIEW)
  getConfig(@CurrentUser() u: AuthUser) { return this.svc.getConfig(u); }

  @Patch('config')
  @RequirePermissions(PERMISSIONS.PACS_ARCHIVE_MANAGE)
  setConfig(@CurrentUser() u: AuthUser, @Body() dto: ArchiveConfigDto, @Req() r: Request) { return this.svc.setConfig(u, dto, r.ip); }

  @Get('monitor')
  @RequirePermissions(PERMISSIONS.PACS_ARCHIVE_VIEW)
  monitor(@CurrentUser() u: AuthUser) { return this.svc.monitor(u); }

  @Get('jobs')
  @RequirePermissions(PERMISSIONS.PACS_ARCHIVE_VIEW)
  listJobs(@CurrentUser() u: AuthUser, @Query() q: any) {
    q.page = q.page ? Number(q.page) : 1; q.pageSize = q.pageSize ? Math.min(Number(q.pageSize), 100) : 25;
    return this.svc.listJobs(u, q);
  }

  @Get('jobs/:id')
  @RequirePermissions(PERMISSIONS.PACS_ARCHIVE_VIEW)
  getJob(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.getJob(u, id); }

  @Post('jobs')
  @RequirePermissions(PERMISSIONS.PACS_ARCHIVE_MANAGE)
  createJob(@CurrentUser() u: AuthUser, @Body() dto: CreateArchiveJobDto, @Req() r: Request) { return this.svc.createJob(u, dto, r.ip); }

  @Post('jobs/:id/cancel')
  @RequirePermissions(PERMISSIONS.PACS_ARCHIVE_MANAGE)
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() r: Request) { return this.svc.cancelJob(u, id, r.ip); }

  @Post('jobs/:id/verify')
  @RequirePermissions(PERMISSIONS.PACS_ARCHIVE_MANAGE)
  verify(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() r: Request) { return this.svc.verifyJob(u, id, r.ip); }

  @Post('jobs/:id/restore')
  @RequirePermissions(PERMISSIONS.PACS_ARCHIVE_MANAGE)
  restore(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() r: Request) { return this.svc.restoreJob(u, id, r.ip); }
}
