import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * Append-only audit record. Never updated or deleted by the app.
   * Phase 8: also records organizationId + username (denormalized) + status.
   * When org/username are not supplied but a userId is, they are derived from
   * the user row (best-effort; a lookup failure never blocks the caller).
   */
  async log(params: {
    userId?: string | null;
    username?: string | null;
    organizationId?: string | null;
    action: string;
    status?: 'SUCCESS' | 'FAILURE';
    entityType?: string;
    entityId?: string;
    detail?: Record<string, unknown>;
    ip?: string;
  }) {
    let { organizationId, username } = params;
    if (params.userId && (organizationId === undefined || username === undefined)) {
      try {
        const u = await this.prisma.user.findUnique({
          where: { id: params.userId },
          select: { organizationId: true, username: true },
        });
        if (u) {
          if (organizationId === undefined) organizationId = u.organizationId;
          if (username === undefined) username = u.username;
        }
      } catch { /* non-fatal: audit must not break the caller */ }
    }
    await this.prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        username: username ?? null,
        organizationId: organizationId ?? null,
        action: params.action,
        status: params.status ?? 'SUCCESS',
        entityType: params.entityType,
        entityId: params.entityId,
        detail: params.detail as any,
        ip: params.ip,
      },
    });
  }
}
