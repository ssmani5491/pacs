import { Controller, Get, Post, Patch, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto, UpdateTemplateDto, SetActiveDto, TemplateQuery } from './templates.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';

@Controller('report-templates')
export class TemplatesController {
  constructor(private svc: TemplatesService) {}

  // Any report-capable user may read templates to use them.
  @Get()
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  list(@CurrentUser() user: AuthUser, @Query() q: TemplateQuery) {
    return this.svc.list(user, q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TEMPLATE_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTemplateDto, @Req() req: Request) {
    return this.svc.create(user, dto, req.ip);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TEMPLATE_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTemplateDto, @Req() req: Request) {
    return this.svc.update(user, id, dto, req.ip);
  }

  @Patch(':id/active')
  @RequirePermissions(PERMISSIONS.TEMPLATE_MANAGE)
  setActive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetActiveDto, @Req() req: Request) {
    return this.svc.setActive(user, id, dto.active, req.ip);
  }
}
