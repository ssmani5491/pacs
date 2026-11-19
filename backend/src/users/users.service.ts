import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../auth/current-user.decorator';
import { PaginationQuery, paginate, buildOrderBy, skipTake } from '../common/pagination';
import { orgScope } from '../common/tenant';
import { CreateUserDto, UpdateUserDto } from './dto';

const SORTABLE = ['username', 'fullName', 'email', 'active', 'createdAt'];
// Exclude password hash from all responses.
const SAFE_SELECT = {
  id: true, username: true, fullName: true, email: true, mobile: true,
  employeeId: true, designation: true, active: true, organizationId: true,
  departmentId: true, lastLoginAt: true, createdAt: true,
  roles: { select: { role: { select: { key: true, name: true } } } },
};

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private auth: AuthService,
  ) {}

  private async resolveRoleIds(roleKeys?: string[]) {
    if (!roleKeys?.length) return [];
    const roles = await this.prisma.role.findMany({ where: { key: { in: roleKeys } } });
    return roles.map((r) => r.id);
  }

  async list(user: AuthUser, q: PaginationQuery) {
    const where: any = { ...orgScope(user) };
    if (q.search) {
      where.OR = [
        { username: { contains: q.search, mode: 'insensitive' } },
        { fullName: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, orderBy: buildOrderBy(q, SORTABLE, 'username'), ...skipTake(q), select: SAFE_SELECT }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(data, total, q);
  }

  async get(user: AuthUser, id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, ...orgScope(user) }, select: SAFE_SELECT });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  async create(user: AuthUser, dto: CreateUserDto, ip?: string) {
    const dup = await this.prisma.user.findFirst({ where: { OR: [{ username: dto.username }, { email: dto.email }] } });
    if (dup) throw new ConflictException('Username or email already in use');

    const organizationId = user.isSuperAdmin ? dto.organizationId : (user.organizationId ?? undefined);
    const passwordHash = await this.auth.hashPassword(dto.password);
    const roleIds = await this.resolveRoleIds(dto.roleKeys);

    const created = await this.prisma.user.create({
      data: {
        username: dto.username, fullName: dto.fullName, email: dto.email,
        mobile: dto.mobile, employeeId: dto.employeeId, designation: dto.designation,
        organizationId, departmentId: dto.departmentId, passwordHash,
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
      select: SAFE_SELECT,
    });
    await this.audit.log({ userId: user.id, action: 'USER_CREATE', entityType: 'User', entityId: created.id, detail: { username: dto.username, roleKeys: dto.roleKeys }, ip });
    return created;
  }

  async update(user: AuthUser, id: string, dto: UpdateUserDto, ip?: string) {
    await this.get(user, id);
    const { roleKeys, ...rest } = dto;
    if (roleKeys) {
      const roleIds = await this.resolveRoleIds(roleKeys);
      await this.prisma.userRole.deleteMany({ where: { userId: id } });
      await this.prisma.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) });
    }
    const updated = await this.prisma.user.update({ where: { id }, data: { ...rest }, select: SAFE_SELECT });
    await this.audit.log({ userId: user.id, action: 'USER_UPDATE', entityType: 'User', entityId: id, detail: { ...dto }, ip });
    return updated;
  }

  async setActive(user: AuthUser, id: string, active: boolean, ip?: string) {
    if (id === user.id && !active) throw new ForbiddenException('Cannot deactivate your own account');
    await this.get(user, id);
    const updated = await this.prisma.user.update({ where: { id }, data: { active }, select: SAFE_SELECT });
    await this.audit.log({ userId: user.id, action: 'USER_STATUS', entityType: 'User', entityId: id, detail: { active }, ip });
    return updated;
  }

  async resetPassword(user: AuthUser, id: string, newPassword: string, ip?: string) {
    await this.get(user, id);
    const passwordHash = await this.auth.hashPassword(newPassword);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    await this.auth.logout(id); // revoke sessions
    await this.audit.log({ userId: user.id, action: 'USER_PASSWORD_RESET', entityType: 'User', entityId: id, ip });
    return { success: true };
  }
}
