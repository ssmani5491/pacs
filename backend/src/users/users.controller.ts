import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { PaginationQuery } from '../common/pagination';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto, SetActiveDto, ResetPasswordDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private svc: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  list(@CurrentUser() user: AuthUser, @Query() q: PaginationQuery) { return this.svc.list(user, q); }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.svc.get(user, id); }

  @Post()
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto, @Req() req: any) { return this.svc.create(user, dto, req.ip); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: any) { return this.svc.update(user, id, dto, req.ip); }

  @Patch(':id/active')
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  setActive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetActiveDto, @Req() req: any) { return this.svc.setActive(user, id, dto.active, req.ip); }

  @Post(':id/reset-password')
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  resetPassword(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ResetPasswordDto, @Req() req: any) { return this.svc.resetPassword(user, id, dto.newPassword, req.ip); }
}
