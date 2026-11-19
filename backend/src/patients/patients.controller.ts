import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { PaginationQuery } from '../common/pagination';
import { PatientsService } from './patients.service';
import { CreatePatientDto, UpdatePatientDto, SetStatusDto, MergePatientDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('patients')
export class PatientsController {
  constructor(private svc: PatientsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PATIENT_VIEW)
  list(@CurrentUser() user: AuthUser, @Query() q: PaginationQuery) { return this.svc.list(user, q); }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PATIENT_VIEW)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.svc.get(user, id); }

  @Get(':id/history')
  @RequirePermissions(PERMISSIONS.PATIENT_VIEW)
  history(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.svc.history(user, id); }

  @Post()
  @RequirePermissions(PERMISSIONS.PATIENT_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePatientDto, @Req() req: any) { return this.svc.create(user, dto, req.ip); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PATIENT_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdatePatientDto, @Req() req: any) { return this.svc.update(user, id, dto, req.ip); }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.PATIENT_MANAGE)
  setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetStatusDto, @Req() req: any) { return this.svc.setStatus(user, id, dto.status, req.ip); }

  @Post('merge')
  @RequirePermissions(PERMISSIONS.PATIENT_MANAGE)
  merge(@CurrentUser() user: AuthUser, @Body() dto: MergePatientDto, @Req() req: any) { return this.svc.merge(user, dto.targetId, dto.sourceId, req.ip); }
}
