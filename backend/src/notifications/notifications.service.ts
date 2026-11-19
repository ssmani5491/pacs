import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { paginate, skipTake } from '../common/pagination';
import { NotificationsGateway } from './notifications.gateway';
import { ROLES } from '../rbac/permissions';

export type NotifPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export interface CreateNotificationInput {
  category: string;
  title: string;
  body?: string;
  priority?: NotifPriority;
  link?: string;
  organizationId?: string | null;
  // recipient: specific user, or a role within the org (fan-out)
  userId?: string | null;
  roleKey?: string | null;
  // optional related entity refs
  patientId?: string; orderId?: string; studyId?: string; reportId?: string;
  dedupKey?: string;
  expiresAt?: Date;
}

/**
 * Central notification service (Phase 8, Modules A & C).
 *
 * Design notes:
 *  - NEVER throws into a clinical workflow: create() swallows its own errors and
 *    logs them, so a notification failure can't fail a DICOM/report transaction.
 *  - Dedup via the unique dedupKey (idempotent re-processing of the same event).
 *  - Role-based notifications fan out to each active user in that role+org.
 *  - Emits over Socket.IO to per-user/per-org rooms (never a global broadcast).
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('NotificationsService');

  constructor(
    private prisma: PrismaService,
    private gateway: NotificationsGateway,
  ) {}

  /** Safe create — returns created rows, or [] on any failure (never throws). */
  async create(input: CreateNotificationInput): Promise<any[]> {
    try {
      const recipients = await this.resolveRecipients(input);
      if (recipients.length === 0) {
        // org/role-wide notification with no specific user (e.g. system alert):
        // store a single org-scoped row with userId null.
        recipients.push(null);
      }
      const created: any[] = [];
      for (const userId of recipients) {
        const dedupKey = input.dedupKey
          ? `${input.dedupKey}:${userId ?? input.roleKey ?? 'org'}`
          : undefined;
        if (dedupKey) {
          const existing = await this.prisma.notification.findUnique({ where: { dedupKey } });
          if (existing) { created.push(existing); continue; }
        }
        try {
          const n = await this.prisma.notification.create({
            data: {
              userId: userId ?? undefined,
              roleKey: userId ? undefined : input.roleKey ?? undefined,
              organizationId: input.organizationId ?? undefined,
              category: input.category,
              priority: input.priority ?? 'NORMAL',
              title: input.title,
              body: input.body,
              link: input.link,
              patientId: input.patientId, orderId: input.orderId,
              studyId: input.studyId, reportId: input.reportId,
              dedupKey,
              expiresAt: input.expiresAt,
            },
          });
          created.push(n);
          // Best-effort realtime emit + delivery record (non-fatal).
          this.emit(n).catch(() => {});
        } catch (e: any) {
          // unique violation (race on dedupKey) -> ignore; anything else -> log.
          if (e?.code !== 'P2002') this.log.warn(`notif create failed: ${e?.message}`);
        }
      }
      return created;
    } catch (e: any) {
      this.log.error(`create() failed (non-fatal): ${e?.message}`);
      return [];
    }
  }

  private async resolveRecipients(input: CreateNotificationInput): Promise<(string | null)[]> {
    if (input.userId) return [input.userId];
    if (input.roleKey) {
      // Fan out to active users holding roleKey IN THE NOTIFICATION'S ORGANIZATION.
      // Org isolation (Phase 9 fix): a role-based notification MUST carry a concrete
      // organizationId. Previously `organizationId: input.organizationId ?? undefined`
      // made Prisma drop the org filter when the org was null, fanning the
      // notification out to that role across EVERY organization. If the org is
      // unknown (e.g. an orphan study with no matched org), we do NOT fan out to a
      // role at all — the notification falls through to a single org-null row
      // (handled by the caller) rather than leaking cross-org.
      if (!input.organizationId) return [];
      const users = await this.prisma.user.findMany({
        where: {
          active: true,
          organizationId: input.organizationId,
          roles: { some: { role: { key: input.roleKey } } },
        },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }
    return [];
  }

  private async emit(n: any) {
    try {
      await this.prisma.notificationDeliveryAttempt.create({
        data: { notificationId: n.id, channel: 'SOCKET', status: 'PENDING' },
      });
      const ok = this.gateway.emitToRecipient(n);
      await this.prisma.notificationDeliveryAttempt.create({
        data: { notificationId: n.id, channel: 'SOCKET', status: ok ? 'DELIVERED' : 'FAILED', error: ok ? undefined : 'no active socket' },
      });
    } catch (e: any) {
      this.log.warn(`emit failed: ${e?.message}`);
    }
  }

  // ───────────────────────── reads / mutations (per-user) ─────────────────────────

  private recipientScope(user: AuthUser) {
    // A user sees: (a) notifications addressed to them directly, and (b) role-based
    // notifications for one of their roles IN THEIR OWN ORGANIZATION.
    //
    // Org match must be EXACT (Phase 9 fix): previously `organizationId:
    // user.organizationId ?? undefined` was used, and when the user's org was null
    // Prisma dropped the filter (`undefined`), so a role notification with a null
    // org could be seen by users of that role across ALL orgs. We now match the
    // concrete org value explicitly (null matches only null).
    const orgEquals = user.organizationId ?? null;
    return {
      OR: [
        { userId: user.id },
        { userId: null, roleKey: { in: user.roles }, organizationId: orgEquals },
      ],
    };
  }

  async list(user: AuthUser, q: any) {
    const where: any = { ...this.recipientScope(user), archived: q.archived === 'true' ? true : false };
    if (q.read === 'true') where.read = true;
    if (q.read === 'false') where.read = false;
    if (q.category) where.category = q.category;
    if (q.priority) where.priority = q.priority;
    if (q.dateFrom || q.dateTo) {
      where.createdAt = {};
      if (q.dateFrom) where.createdAt.gte = new Date(q.dateFrom);
      if (q.dateTo) { const d = new Date(q.dateTo); d.setHours(23, 59, 59, 999); where.createdAt.lte = d; }
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.notification.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  async unreadCount(user: AuthUser) {
    const count = await this.prisma.notification.count({
      where: { ...this.recipientScope(user), read: false, archived: false },
    });
    return { count };
  }

  async getOne(user: AuthUser, id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n || !this.canAccess(user, n)) throw new NotFoundException('Notification not found');
    return n;
  }

  private canAccess(user: AuthUser, n: any): boolean {
    if (n.userId && n.userId === user.id) return true;
    if (!n.userId && n.roleKey && user.roles.includes(n.roleKey) &&
        (!n.organizationId || n.organizationId === user.organizationId)) return true;
    return user.isSuperAdmin;
  }

  async markRead(user: AuthUser, id: string) {
    const n = await this.getOne(user, id);
    if (n.read) return n;
    return this.prisma.notification.update({ where: { id }, data: { read: true, readAt: new Date() } });
  }

  async markAllRead(user: AuthUser) {
    const res = await this.prisma.notification.updateMany({
      where: { ...this.recipientScope(user), read: false, archived: false },
      data: { read: true, readAt: new Date() },
    });
    return { updated: res.count };
  }

  async archive(user: AuthUser, id: string) {
    await this.getOne(user, id);
    return this.prisma.notification.update({ where: { id }, data: { archived: true } });
  }

  async remove(user: AuthUser, id: string) {
    // Deletion is permitted only for the recipient's own archived notification.
    const n = await this.getOne(user, id);
    if (!n.archived) throw new ForbiddenException('Archive the notification before deleting');
    await this.prisma.notification.delete({ where: { id } });
    return { ok: true };
  }
}
