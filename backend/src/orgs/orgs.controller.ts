import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { PaginationQuery } from '../common/pagination';
import { OrgsService } from './orgs.service';
import { CreateOrgDto, UpdateOrgDto, SetActiveDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrgsController {
  constructor(private svc: OrgsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ORG_MANAGE)
  list(@CurrentUser() user: AuthUser, @Query() q: PaginationQuery) {
    return this.svc.list(user, q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ORG_MANAGE)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ORG_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrgDto, @Req() req: any) {
    return this.svc.create(user, dto, req.ip);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ORG_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateOrgDto, @Req() req: any) {
    return this.svc.update(user, id, dto, req.ip);
  }

  @Patch(':id/active')
  @RequirePermissions(PERMISSIONS.ORG_MANAGE)
  setActive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetActiveDto, @Req() req: any) {
    return this.svc.setActive(user, id, dto.active, req.ip);
  }
}
