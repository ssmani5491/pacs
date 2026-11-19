import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { PaginationQuery } from '../common/pagination';
import { ModalitiesService } from './modalities.service';
import { CreateModalityDto, UpdateModalityDto, SetActiveDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('modalities')
export class ModalitiesController {
  constructor(private svc: ModalitiesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MODALITY_MANAGE)
  list(@CurrentUser() user: AuthUser, @Query() q: PaginationQuery) { return this.svc.list(user, q); }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.MODALITY_MANAGE)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.svc.get(user, id); }

  @Post()
  @RequirePermissions(PERMISSIONS.MODALITY_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateModalityDto, @Req() req: any) { return this.svc.create(user, dto, req.ip); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.MODALITY_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateModalityDto, @Req() req: any) { return this.svc.update(user, id, dto, req.ip); }

  @Patch(':id/active')
  @RequirePermissions(PERMISSIONS.MODALITY_MANAGE)
  setActive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetActiveDto, @Req() req: any) { return this.svc.setActive(user, id, dto.active, req.ip); }

  @Post(':id/test-connection')
  @RequirePermissions(PERMISSIONS.MODALITY_MANAGE)
  test(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.svc.testConnection(user, id); }
}
