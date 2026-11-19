import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';
import { paginate, skipTake, buildOrderBy } from '../common/pagination';

/** Report template management (Phase 7, Module 3). Org-scoped; global templates
 * (organizationId null) are visible to everyone. template.manage required to write. */
@Injectable()
export class TemplatesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private orgFilter(user: AuthUser) {
    if (user.isSuperAdmin) return {};
    return { OR: [{ organizationId: user.organizationId ?? undefined }, { organizationId: null }] };
  }

  async list(user: AuthUser, q: any) {
    const where: any = { ...this.orgFilter(user) };
    if (q.modality) where.modalityType = q.modality;
    if (q.active !== undefined) where.active = q.active === 'true';
    if (q.search) where.name = { contains: q.search, mode: 'insensitive' };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.reportTemplate.findMany({ where, orderBy: buildOrderBy(q, ['name', 'modalityType', 'createdAt'], 'name'), ...skipTake(q) }),
      this.prisma.reportTemplate.count({ where }),
    ]);
    return paginate(data, total, q);
  }

  async get(user: AuthUser, id: string) {
    const t = await this.prisma.reportTemplate.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Template not found');
    if (!user.isSuperAdmin && t.organizationId && t.organizationId !== user.organizationId) {
      throw new ForbiddenException('Template belongs to another organization');
    }
    return t;
  }

  async create(user: AuthUser, dto: any, ip?: string) {
    const organizationId = user.isSuperAdmin ? (dto.organizationId ?? null) : (user.organizationId ?? null);
    const t = await this.prisma.reportTemplate.create({
      data: {
        name: dto.name, code: dto.code, modalityType: dto.modalityType, departmentId: dto.departmentId,
        organizationId, technique: dto.technique, bodyFindings: dto.bodyFindings,
        bodyImpression: dto.bodyImpression, bodyRecommendations: dto.bodyRecommendations,
        defaultText: dto.defaultText, active: dto.active ?? true,
      },
    });
    await this.audit.log({ userId: user.id, action: 'TEMPLATE_CREATE', entityType: 'ReportTemplate', entityId: t.id, ip });
    return t;
  }

  async update(user: AuthUser, id: string, dto: any, ip?: string) {
    await this.get(user, id);
    const data: any = {};
    for (const k of ['name', 'code', 'modalityType', 'departmentId', 'technique', 'bodyFindings', 'bodyImpression', 'bodyRecommendations', 'defaultText', 'active'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    const t = await this.prisma.reportTemplate.update({ where: { id }, data });
    await this.audit.log({ userId: user.id, action: 'TEMPLATE_UPDATE', entityType: 'ReportTemplate', entityId: id, ip });
    return t;
  }

  async setActive(user: AuthUser, id: string, active: boolean, ip?: string) {
    await this.get(user, id);
    const t = await this.prisma.reportTemplate.update({ where: { id }, data: { active } });
    await this.audit.log({ userId: user.id, action: active ? 'TEMPLATE_ACTIVATE' : 'TEMPLATE_DEACTIVATE', entityType: 'ReportTemplate', entityId: id, ip });
    return t;
  }
}
