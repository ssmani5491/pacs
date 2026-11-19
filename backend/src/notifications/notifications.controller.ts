import { Controller, Get, Patch, Delete, Param, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions';

@Controller('notifications')
export class NotificationsController {
  constructor(private svc: NotificationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.NOTIFICATION_VIEW)
  list(@CurrentUser() user: AuthUser, @Query() q: any) {
    q.page = q.page ? Number(q.page) : 1;
    q.pageSize = q.pageSize ? Math.min(Number(q.pageSize), 100) : 20;
    return this.svc.list(user, q);
  }

  @Get('unread-count')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_VIEW)
  unread(@CurrentUser() user: AuthUser) {
    return this.svc.unreadCount(user);
  }

  @Patch('read-all')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_VIEW)
  readAll(@CurrentUser() user: AuthUser) {
    return this.svc.markAllRead(user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_VIEW)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getOne(user, id);
  }

  @Patch(':id/read')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_VIEW)
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.markRead(user, id);
  }

  @Patch(':id/archive')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_VIEW)
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.archive(user, id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_VIEW)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
