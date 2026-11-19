import { Controller, Get, Query } from '@nestjs/common';
import { ReportingWorklistService } from './reporting-worklist.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';

@Controller('reporting-worklist')
export class ReportingWorklistController {
  constructor(private svc: ReportingWorklistService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  list(@CurrentUser() user: AuthUser, @Query() q: any) {
    // coerce numeric paging
    q.page = q.page ? Number(q.page) : 1;
    q.pageSize = q.pageSize ? Number(q.pageSize) : 20;
    return this.svc.list(user, q);
  }

  @Get('counts')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  counts(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.counts(user, q);
  }
}
