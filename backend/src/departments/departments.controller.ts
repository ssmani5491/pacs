import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { PaginationQuery } from '../common/pagination';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto, UpdateDepartmentDto, SetActiveDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private svc: DepartmentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.DEPT_MANAGE)
  list(@CurrentUser() user: AuthUser, @Query() q: PaginationQuery, @Query('organizationId') orgId?: string) {
    return this.svc.list(user, q, orgId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.DEPT_MANAGE)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.DEPT_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDepartmentDto, @Req() req: any) {
    return this.svc.create(user, dto, req.ip);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.DEPT_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateDepartmentDto, @Req() req: any) {
    return this.svc.update(user, id, dto, req.ip);
  }

  @Patch(':id/active')
  @RequirePermissions(PERMISSIONS.DEPT_MANAGE)
  setActive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetActiveDto, @Req() req: any) {
    return this.svc.setActive(user, id, dto.active, req.ip);
  }
}
