import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { IsString, IsOptional, IsNotEmpty, MaxLength, IsIn } from 'class-validator';
import { MacrosService } from './macros.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';

class CreateMacroDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsOptional() @IsIn(['personal', 'organization']) scope?: string;
  @IsOptional() @IsString() @MaxLength(16) modalityType?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() @MaxLength(20000) findings?: string;
  @IsOptional() @IsString() @MaxLength(10000) impression?: string;
  @IsOptional() @IsString() @MaxLength(10000) recommendations?: string;
}
class UpdateMacroDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(16) modalityType?: string;
  @IsOptional() @IsString() @MaxLength(20000) findings?: string;
  @IsOptional() @IsString() @MaxLength(10000) impression?: string;
  @IsOptional() @IsString() @MaxLength(10000) recommendations?: string;
}

@Controller('report-macros')
export class MacrosController {
  constructor(private svc: MacrosService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  list(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.list(user, q);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.REPORT_CREATE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMacroDto, @Req() req: Request) {
    return this.svc.create(user, dto, req.ip);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.REPORT_CREATE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateMacroDto, @Req() req: Request) {
    return this.svc.update(user, id, dto, req.ip);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.REPORT_CREATE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.svc.remove(user, id, req.ip);
  }
}
