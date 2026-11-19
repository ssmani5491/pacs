import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { PaginationQuery } from '../common/pagination';
import { DoctorsService } from './doctors.service';
import { CreateDoctorDto, UpdateDoctorDto, SetActiveDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('doctors')
export class DoctorsController {
  constructor(private svc: DoctorsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.DOCTOR_MANAGE)
  list(@CurrentUser() user: AuthUser, @Query() q: PaginationQuery) { return this.svc.list(user, q); }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.DOCTOR_MANAGE)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.svc.get(user, id); }

  @Post()
  @RequirePermissions(PERMISSIONS.DOCTOR_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDoctorDto, @Req() req: any) { return this.svc.create(user, dto, req.ip); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.DOCTOR_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateDoctorDto, @Req() req: any) { return this.svc.update(user, id, dto, req.ip); }

  @Patch(':id/active')
  @RequirePermissions(PERMISSIONS.DOCTOR_MANAGE)
  setActive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetActiveDto, @Req() req: any) { return this.svc.setActive(user, id, dto.active, req.ip); }
}
