import { Controller, Get, Query } from '@nestjs/common';
import { BackupService } from './backup.service';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';

@Controller('backups')
export class BackupController {
  constructor(private svc: BackupService) {}

  // READ-ONLY status reporting — same permission already used for background
  // job visibility (system.jobs.view).
  @Get()
  @RequirePermissions(PERMISSIONS.SYSTEM_JOBS_VIEW)
  list(@Query('limit') limit?: string) {
    return this.svc.listRuns(limit ? Number(limit) : undefined);
  }
}
