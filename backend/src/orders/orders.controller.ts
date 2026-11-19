import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';
import { PaginationQuery } from '../common/pagination';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderDto, AssignDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private svc: OrdersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ORDER_MANAGE)
  list(@CurrentUser() user: AuthUser, @Query() q: PaginationQuery, @Query('status') status?: string) { return this.svc.list(user, q, status); }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ORDER_MANAGE)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.svc.get(user, id); }

  @Post()
  @RequirePermissions(PERMISSIONS.ORDER_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto, @Req() req: any) { return this.svc.create(user, dto, req.ip); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ORDER_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateOrderDto, @Req() req: any) { return this.svc.update(user, id, dto, req.ip); }

  @Patch(':id/cancel')
  @RequirePermissions(PERMISSIONS.ORDER_MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: any) { return this.svc.cancel(user, id, req.ip); }

  @Patch(':id/assign')
  @RequirePermissions(PERMISSIONS.ORDER_MANAGE)
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AssignDto, @Req() req: any) { return this.svc.assign(user, id, dto.assignedUserId, req.ip); }
}
