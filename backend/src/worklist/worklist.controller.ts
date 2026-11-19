import { Controller, Get, Post, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { WorklistService } from './worklist.service';
import { WorklistQuery, AssignStudyDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('worklist')
export class WorklistController {
  constructor(private svc: WorklistService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WORKLIST_VIEW)
  list(@CurrentUser() user: AuthUser, @Query() q: WorklistQuery) { return this.svc.query(user, q); }

  @Get('counts')
  @RequirePermissions(PERMISSIONS.WORKLIST_VIEW)
  counts(@CurrentUser() user: AuthUser, @Query() q: WorklistQuery) { return this.svc.counts(user, q); }

  @Get('pending-assignment')
  @RequirePermissions(PERMISSIONS.WORKLIST_VIEW)
  pending(@CurrentUser() user: AuthUser, @Query() q: WorklistQuery) { return this.svc.pendingAssignment(user, q); }

  @Get(':id/assignments')
  @RequirePermissions(PERMISSIONS.WORKLIST_VIEW)
  history(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.svc.assignmentHistory(user, id); }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.STUDY_ASSIGN)
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AssignStudyDto, @Req() req: any) {
    return this.svc.assign(user, id, dto.userId, req.ip);
  }
}
