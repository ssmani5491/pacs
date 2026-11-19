import { Controller, Get, Post, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { IsUUID, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { PaginationQuery } from '../common/pagination';
import { PacsService } from './pacs.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { ReceptionLogQuery } from './dto';

class ReconcileDto {
  @IsUUID() patientId!: string;
  @IsOptional() @IsString() accessionNumber?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('pacs')
export class PacsController {
  constructor(private pacs: PacsService, private recon: ReconciliationService) {}

  @Get('monitor')
  @RequirePermissions(PERMISSIONS.WORKLIST_VIEW)
  monitor() { return this.pacs.monitor(); }

  @Get('reception-logs')
  @RequirePermissions(PERMISSIONS.WORKLIST_VIEW)
  logs(@Query() q: ReceptionLogQuery) { return this.pacs.receptionLogs(q, q.status); }

  @Get('modalities/status')
  @RequirePermissions(PERMISSIONS.MODALITY_MANAGE)
  modalityStatus(@CurrentUser() user: AuthUser) { return this.pacs.modalityStatus(user); }

  @Get('mwl/monitor')
  @RequirePermissions(PERMISSIONS.WORKLIST_VIEW)
  mwlMonitor() { return this.pacs.mwlMonitor(); }

  @Get('mwl/logs')
  @RequirePermissions(PERMISSIONS.WORKLIST_VIEW)
  mwlLogs(@Query() q: ReceptionLogQuery) { return this.pacs.mwlLogs(q, q.status); }

  @Get('reconciliation/unmatched')
  @RequirePermissions(PERMISSIONS.STUDY_VIEW)
  unmatched(@CurrentUser() user: AuthUser, @Query() q: PaginationQuery) { return this.recon.unmatched(user, q); }

  @Get('reconciliation/duplicates')
  @RequirePermissions(PERMISSIONS.STUDY_VIEW)
  duplicates(@CurrentUser() user: AuthUser) { return this.recon.duplicates(user); }

  @Post('reconciliation/:studyId/reconcile')
  @RequirePermissions(PERMISSIONS.STUDY_ASSIGN)
  reconcile(@CurrentUser() user: AuthUser, @Param('studyId') studyId: string, @Body() dto: ReconcileDto, @Req() req: any) {
    return this.recon.reconcile(user, studyId, dto.patientId, dto.accessionNumber, req.ip);
  }
}
