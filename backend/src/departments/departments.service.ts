import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';
import { PaginationQuery, paginate, buildOrderBy, skipTake } from '../common/pagination';
import { orgScope } from '../common/tenant';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto';

const SORTABLE = ['code', 'name', 'active', 'createdAt'];

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private assertWrite(user: AuthUser, orgId: string) {
    if (!user.isSuperAdmin && user.organizationId !== orgId) {
      throw new ForbiddenException('Cross-organization write denied');
    }
  }

  async list(user: AuthUser, q: PaginationQuery, organizationId?: string) {
    const where: any = { ...orgScope(user) };
    if (organizationId) where.organizationId = organizationId;
    if (q.search) {
      where.OR = [
        { code: { contains: q.search, mode: 'insensitive' } },
        { name: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.department.findMany({
        where, orderBy: buildOrderBy(q, SORTABLE, 'name'), ...skipTake(q),
        include: { organization: { select: { code: true, name: true } } },
      }),
      this.prisma.department.count({ where }),
    ]);
    return paginate(data, total, q);
  }

  async get(user: AuthUser, id: string) {
    const dep = await this.prisma.department.findFirst({ where: { id, ...orgScope(user) } });
    if (!dep) throw new NotFoundException('Department not found');
    return dep;
  }

  async create(user: AuthUser, dto: CreateDepartmentDto, ip?: string) {
    this.assertWrite(user, dto.organizationId);
    const dup = await this.prisma.department.findFirst({
      where: { organizationId: dto.organizationId, code: dto.code },
    });
    if (dup) throw new ConflictException('Department code already exists in this organization');
    const dep = await this.prisma.department.create({ data: { ...dto } });
    await this.audit.log({ userId: user.id, action: 'DEPT_CREATE', entityType: 'Department', entityId: dep.id, detail: { code: dep.code }, ip });
    return dep;
  }

  async update(user: AuthUser, id: string, dto: UpdateDepartmentDto, ip?: string) {
    const dep = await this.get(user, id);
    this.assertWrite(user, dep.organizationId);
    const updated = await this.prisma.department.update({ where: { id }, data: { ...dto } });
    await this.audit.log({ userId: user.id, action: 'DEPT_UPDATE', entityType: 'Department', entityId: id, detail: { ...dto }, ip });
    return updated;
  }

  async setActive(user: AuthUser, id: string, active: boolean, ip?: string) {
    const dep = await this.get(user, id);
    this.assertWrite(user, dep.organizationId);
    const updated = await this.prisma.department.update({ where: { id }, data: { active } });
    await this.audit.log({ userId: user.id, action: 'DEPT_STATUS', entityType: 'Department', entityId: id, detail: { active }, ip });
    return updated;
  }
}
