import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';
import { PaginationQuery, paginate, buildOrderBy, skipTake } from '../common/pagination';
import { orgScope } from '../common/tenant';
import { CreateDoctorDto, UpdateDoctorDto } from './dto';

const SORTABLE = ['name', 'specialization', 'active', 'createdAt'];

@Injectable()
export class DoctorsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async list(user: AuthUser, q: PaginationQuery) {
    const where: any = { ...orgScope(user) };
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { specialization: { contains: q.search, mode: 'insensitive' } },
        { registrationNo: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.doctor.findMany({ where, orderBy: buildOrderBy(q, SORTABLE, 'name'), ...skipTake(q) }),
      this.prisma.doctor.count({ where }),
    ]);
    return paginate(data, total, q);
  }

  async get(user: AuthUser, id: string) {
    const doc = await this.prisma.doctor.findFirst({ where: { id, ...orgScope(user) } });
    if (!doc) throw new NotFoundException('Doctor not found');
    return doc;
  }

  async create(user: AuthUser, dto: CreateDoctorDto, ip?: string) {
    const organizationId = user.isSuperAdmin ? dto.organizationId : (user.organizationId ?? undefined);
    const doc = await this.prisma.doctor.create({ data: { ...dto, organizationId } });
    await this.audit.log({ userId: user.id, action: 'DOCTOR_CREATE', entityType: 'Doctor', entityId: doc.id, detail: { name: doc.name }, ip });
    return doc;
  }

  async update(user: AuthUser, id: string, dto: UpdateDoctorDto, ip?: string) {
    await this.get(user, id);
    const doc = await this.prisma.doctor.update({ where: { id }, data: { ...dto } });
    await this.audit.log({ userId: user.id, action: 'DOCTOR_UPDATE', entityType: 'Doctor', entityId: id, detail: { ...dto }, ip });
    return doc;
  }

  async setActive(user: AuthUser, id: string, active: boolean, ip?: string) {
    await this.get(user, id);
    const doc = await this.prisma.doctor.update({ where: { id }, data: { active } });
    await this.audit.log({ userId: user.id, action: 'DOCTOR_STATUS', entityType: 'Doctor', entityId: id, detail: { active }, ip });
    return doc;
  }
}
