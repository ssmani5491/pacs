import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';
import { paginate, skipTake } from '../common/pagination';

export type AlertLevel = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';

/**
 * System alerts (Phase 8, Module F). Dedup by alertKey: re-raising an open alert
 * bumps occurrences + lastSeenAt rather than creating a duplicate. Recovery is
 * NOT automatic on a single healthy check — the scheduler calls recover() only
 * after N consecutive healthy checks (see ops.scheduler).
 */
@Injectable()
export class AlertsService {
  private readonly log = new Logger('AlertsService');
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Raise (or bump) an alert. Idempotent per alertKey while OPEN/ACKNOWLEDGED. */
  async raise(input: { alertKey: string; level: AlertLevel; title: string; detail?: string; source?: string; organizationId?: string | null }) {
    try {
      const open = await this.prisma.systemAlert.findFirst({
        where: { alertKey: input.alertKey, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (open) {
        return this.prisma.systemAlert.update({
          where: { id: open.id },
          data: { lastSeenAt: new Date(), occurrences: { increment: 1 }, level: input.level, detail: input.detail ?? open.detail },
        });
      }
      const created = await this.prisma.systemAlert.create({
        data: {
          alertKey: input.alertKey, level: input.level, title: input.title, detail: input.detail,
          source: input.source, organizationId: input.organizationId ?? null, status: 'OPEN',
        },
      });
      await this.audit.log({ userId: null, action: 'ALERT_RAISED', status: 'FAILURE', entityType: 'SystemAlert', entityId: created.id, detail: { alertKey: input.alertKey, level: input.level } });
      return created;
    } catch (e: any) {
      this.log.warn(`raise failed: ${e?.message}`);
      return null;
    }
  }

  /** Resolve an alert via recovery (SYSTEM) after sustained health. */
  async recover(alertKey: string) {
    const open = await this.prisma.systemAlert.findFirst({ where: { alertKey, status: { in: ['OPEN', 'ACKNOWLEDGED'] } } });
    if (!open) return null;
    const resolved = await this.prisma.systemAlert.update({
      where: { id: open.id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: 'SYSTEM' },
    });
    await this.audit.log({ userId: null, action: 'ALERT_RECOVERED', entityType: 'SystemAlert', entityId: open.id, detail: { alertKey } });
    return resolved;
  }

  // ───────── operator actions ─────────

  async list(user: AuthUser, q: any) {
    const where: any = {};
    if (!user.isSuperAdmin) where.OR = [{ organizationId: user.organizationId ?? '__none__' }, { organizationId: null }];
    if (q.status) where.status = q.status;
    if (q.level) where.level = q.level;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.systemAlert.findMany({ where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], ...skipTake(q) }),
      this.prisma.systemAlert.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  async acknowledge(user: AuthUser, id: string, ip?: string) {
    const a = await this.prisma.systemAlert.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Alert not found');
    if (a.status === 'RESOLVED') return a;
    const updated = await this.prisma.systemAlert.update({
      where: { id }, data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedBy: user.id },
    });
    await this.audit.log({ userId: user.id, action: 'ALERT_ACKNOWLEDGE', entityType: 'SystemAlert', entityId: id, ip });
    return updated;
  }

  async resolve(user: AuthUser, id: string, ip?: string) {
    const a = await this.prisma.systemAlert.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Alert not found');
    if (a.status === 'RESOLVED') return a;
    const updated = await this.prisma.systemAlert.update({
      where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: user.id },
    });
    await this.audit.log({ userId: user.id, action: 'ALERT_RESOLVE', entityType: 'SystemAlert', entityId: id, ip });
    return updated;
  }

  async openCount(user: AuthUser) {
    const where: any = { status: { in: ['OPEN', 'ACKNOWLEDGED'] } };
    if (!user.isSuperAdmin) where.OR = [{ organizationId: user.organizationId ?? '__none__' }, { organizationId: null }];
    const [open, critical] = await this.prisma.$transaction([
      this.prisma.systemAlert.count({ where }),
      this.prisma.systemAlert.count({ where: { ...where, level: 'CRITICAL' } }),
    ]);
    return { open, critical };
  }
}
