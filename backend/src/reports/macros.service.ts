import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';

/** Reusable reporting macros (Phase 7, Module 9). A macro is personal (ownerUserId
 * = me), department-shared, or org-shared. report.create permission gates writes. */
@Injectable()
export class MacrosService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Macros visible to the user: own personal + org/dept-shared + global. */
  async list(user: AuthUser, q: any) {
    const where: any = {
      active: true,
      OR: [
        { ownerUserId: user.id },
        { ownerUserId: null, organizationId: user.organizationId ?? undefined },
        { ownerUserId: null, organizationId: null },
      ],
    };
    if (q?.modality) where.modalityType = q.modality;
    return this.prisma.reportMacro.findMany({ where, orderBy: { name: 'asc' } });
  }

  async create(user: AuthUser, dto: any, ip?: string) {
    // scope: 'personal' (default) | 'organization'
    const shared = dto.scope === 'organization';
    const m = await this.prisma.reportMacro.create({
      data: {
        name: dto.name,
        ownerUserId: shared ? null : user.id,
        organizationId: shared ? (user.organizationId ?? null) : null,
        departmentId: dto.departmentId ?? null,
        modalityType: dto.modalityType ?? null,
        findings: dto.findings, impression: dto.impression, recommendations: dto.recommendations,
      },
    });
    await this.audit.log({ userId: user.id, action: 'MACRO_CREATE', entityType: 'ReportMacro', entityId: m.id, ip });
    return m;
  }

  async update(user: AuthUser, id: string, dto: any, ip?: string) {
    const m = await this.prisma.reportMacro.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Macro not found');
    // only the owner (personal) or an org member with manage rights may edit
    if (m.ownerUserId && m.ownerUserId !== user.id && !user.isSuperAdmin) {
      throw new ForbiddenException('Not your macro');
    }
    if (!m.ownerUserId && !user.isSuperAdmin && m.organizationId !== user.organizationId) {
      throw new ForbiddenException('Macro belongs to another organization');
    }
    const data: any = {};
    for (const k of ['name', 'modalityType', 'departmentId', 'findings', 'impression', 'recommendations', 'active'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    const updated = await this.prisma.reportMacro.update({ where: { id }, data });
    await this.audit.log({ userId: user.id, action: 'MACRO_UPDATE', entityType: 'ReportMacro', entityId: id, ip });
    return updated;
  }

  async remove(user: AuthUser, id: string, ip?: string) {
    const m = await this.prisma.reportMacro.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Macro not found');
    if (m.ownerUserId && m.ownerUserId !== user.id && !user.isSuperAdmin) {
      throw new ForbiddenException('Not your macro');
    }
    // soft delete (keep audit trail integrity)
    await this.prisma.reportMacro.update({ where: { id }, data: { active: false } });
    await this.audit.log({ userId: user.id, action: 'MACRO_DELETE', entityType: 'ReportMacro', entityId: id, ip });
    return { ok: true };
  }
}
