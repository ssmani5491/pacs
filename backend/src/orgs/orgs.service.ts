import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';
import { PaginationQuery, paginate, buildOrderBy, skipTake } from '../common/pagination';
import { orgSelfScope } from '../common/tenant';
import { CreateOrgDto, UpdateOrgDto } from './dto';

const SORTABLE = ['code', 'name', 'active', 'createdAt'];

@Injectable()
export class OrgsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async list(user: AuthUser, q: PaginationQuery) {
    const where: any = { ...orgSelfScope(user) };
    if (q.search) {
      where.OR = [
        { code: { contains: q.search, mode: 'insensitive' } },
        { name: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.organization.findMany({
        where,
        orderBy: buildOrderBy(q, SORTABLE, 'name'),
        ...skipTake(q),
      }),
      this.prisma.organization.count({ where }),
    ]);
    return paginate(data, total, q);
  }

  async get(user: AuthUser, id: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id, ...orgSelfScope(user) },
      include: { _count: { select: { departments: true, users: true } } },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async create(user: AuthUser, dto: CreateOrgDto, ip?: string) {
    const exists = await this.prisma.organization.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException('Organization code already exists');
    const org = await this.prisma.organization.create({ data: { ...dto } });
    await this.audit.log({
      userId: user.id, action: 'ORG_CREATE', entityType: 'Organization',
      entityId: org.id, detail: { code: org.code }, ip,
    });
    return org;
  }

  async update(user: AuthUser, id: string, dto: UpdateOrgDto, ip?: string) {
    await this.get(user, id); // scope check
    const org = await this.prisma.organization.update({ where: { id }, data: { ...dto } });
    await this.audit.log({
      userId: user.id, action: 'ORG_UPDATE', entityType: 'Organization',
      entityId: id, detail: { ...dto }, ip,
    });
    return org;
  }

  async setActive(user: AuthUser, id: string, active: boolean, ip?: string) {
    await this.get(user, id);
    const org = await this.prisma.organization.update({ where: { id }, data: { active } });
    await this.audit.log({
      userId: user.id, action: 'ORG_STATUS', entityType: 'Organization',
      entityId: id, detail: { active }, ip,
    });
    return org;
  }
}
