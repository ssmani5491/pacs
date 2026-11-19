import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { AuthUser } from '../auth/current-user.decorator';
import { paginate, skipTake } from '../common/pagination';

const EXPORT_LIMIT = 10000;

/** Audit viewer + CSV export (Phase 8, Module D). Read-only over append-only
 * audit_logs. Org isolation: non-super-admin sees only their org's rows. */
@Injectable()
export class AuditViewerService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private where(user: AuthUser, q: any) {
    const where: any = {};
    if (!user.isSuperAdmin) where.organizationId = user.organizationId ?? '__none__';
    else if (q.organizationId) where.organizationId = q.organizationId;

    if (q.username) where.username = { contains: q.username, mode: 'insensitive' };
    if (q.action) where.action = { contains: q.action, mode: 'insensitive' };
    if (q.entityType) where.entityType = q.entityType;
    if (q.status) where.status = q.status;
    if (q.ip) where.ip = { contains: q.ip };
    if (q.dateFrom || q.dateTo) {
      where.createdAt = {};
      if (q.dateFrom) where.createdAt.gte = new Date(q.dateFrom);
      if (q.dateTo) { const d = new Date(q.dateTo); d.setHours(23, 59, 59, 999); where.createdAt.lte = d; }
    }
    return where;
  }

  async list(user: AuthUser, q: any) {
    const where = this.where(user, q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where, orderBy: { createdAt: 'desc' }, ...skipTake(q),
        include: { user: { select: { fullName: true, username: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const data = rows.map((r: any) => ({
      id: r.id,
      createdAt: r.createdAt,
      userId: r.userId,
      username: r.username ?? r.user?.username ?? null,
      fullName: r.user?.fullName ?? null,
      organizationId: r.organizationId,
      action: r.action,
      status: r.status,
      entityType: r.entityType,
      entityId: r.entityId,
      ip: r.ip,
      detail: r.detail,
    }));
    return paginate(data, total, q);
  }

  async get(user: AuthUser, id: string) {
    const r = await this.prisma.auditLog.findUnique({
      where: { id },
      include: { user: { select: { fullName: true, username: true } } },
    });
    if (!r) return null;
    if (!user.isSuperAdmin && r.organizationId !== user.organizationId) return null;
    return r;
  }

  /** CSV export — same filters + permissions; formula-injection safe; audited. */
  async exportCsv(user: AuthUser, q: any, ip?: string): Promise<string> {
    const where = this.where(user, q);
    const rows = await this.prisma.auditLog.findMany({
      where, orderBy: { createdAt: 'desc' }, take: EXPORT_LIMIT,
      include: { user: { select: { username: true } } },
    });

    const headers = ['timestamp', 'username', 'organizationId', 'action', 'status', 'entityType', 'entityId', 'ip'];
    const lines = [headers.join(',')];
    for (const r of rows as any[]) {
      lines.push([
        r.createdAt.toISOString(),
        csv(r.username ?? r.user?.username ?? ''),
        csv(r.organizationId ?? ''),
        csv(r.action),
        csv(r.status ?? ''),
        csv(r.entityType ?? ''),
        csv(r.entityId ?? ''),
        csv(r.ip ?? ''),
      ].join(','));
    }

    // Audit the export itself (who, when, how many, filters).
    await this.audit.log({
      userId: user.id, action: 'AUDIT_EXPORT', status: 'SUCCESS',
      detail: { rows: rows.length, filters: sanitizeFilters(q), exportedAt: new Date().toISOString() },
      ip,
    });

    const banner = `# Audit export | by ${user.username} | ${new Date().toISOString()} | ${rows.length} rows (max ${EXPORT_LIMIT})\n`;
    return banner + lines.join('\n') + '\n';
  }
}

/** CSV-escape + neutralize spreadsheet formula injection (=,+,-,@, tab, CR). */
function csv(v: string): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // prefix to defang formulas
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function sanitizeFilters(q: any) {
  const out: Record<string, any> = {};
  for (const k of ['username', 'action', 'entityType', 'status', 'ip', 'dateFrom', 'dateTo', 'organizationId']) {
    if (q[k] !== undefined) out[k] = String(q[k]).slice(0, 200);
  }
  return out;
}
