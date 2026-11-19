import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';
import { PaginationQuery, paginate, buildOrderBy, skipTake } from '../common/pagination';
import { orgScope } from '../common/tenant';
import { CreatePatientDto, UpdatePatientDto } from './dto';

const SORTABLE = ['mrn', 'name', 'gender', 'status', 'registrationDate', 'createdAt'];

function calcAge(dob?: Date | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

@Injectable()
export class PatientsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private withAge<T extends { dob: Date | null }>(p: T) {
    return { ...p, age: calcAge(p.dob) };
  }

  /** Generate a per-organization MRN like GG00000001. Prefix from org code. */
  private async generateMrn(organizationId?: string): Promise<string> {
    let prefix = 'GG';
    if (organizationId) {
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
      if (org?.code) prefix = org.code.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'GG';
    }
    // Count existing patients in the org to form a sequence (simple, race-tolerant with retry).
    const count = await this.prisma.patient.count({ where: { organizationId: organizationId ?? undefined } });
    let seq = count + 1;
    // ensure uniqueness
    for (let i = 0; i < 50; i++) {
      const mrn = `${prefix}${String(seq).padStart(8, '0')}`;
      const exists = await this.prisma.patient.findFirst({ where: { organizationId: organizationId ?? undefined, mrn } });
      if (!exists) return mrn;
      seq++;
    }
    return `${prefix}${Date.now()}`;
  }

  async list(user: AuthUser, q: PaginationQuery) {
    const where: any = { ...orgScope(user) };
    if (q.search) {
      where.OR = [
        { mrn: { contains: q.search, mode: 'insensitive' } },
        { name: { contains: q.search, mode: 'insensitive' } },
        { mobile: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.patient.findMany({ where, orderBy: buildOrderBy(q, SORTABLE, 'registrationDate'), ...skipTake(q) }),
      this.prisma.patient.count({ where }),
    ]);
    return paginate(data.map((p) => this.withAge(p)), total, q);
  }

  async get(user: AuthUser, id: string) {
    const p = await this.prisma.patient.findFirst({
      where: { id, ...orgScope(user) },
      include: { referringDoctor: { select: { name: true } }, organization: { select: { code: true, name: true } } },
    });
    if (!p) throw new NotFoundException('Patient not found');
    return this.withAge(p);
  }

  /** Patient demographics + examination/study history. */
  async history(user: AuthUser, id: string) {
    const patient = await this.get(user, id);
    const [orders, studies] = await this.prisma.$transaction([
      this.prisma.scheduledOrder.findMany({ where: { patientId: id }, orderBy: { scheduledAt: 'desc' }, take: 200 }),
      this.prisma.study.findMany({
        where: { patientId: id }, orderBy: { studyDate: 'desc' }, take: 200,
        select: { id: true, accessionNumber: true, studyDate: true, modality: true, description: true, reportStatus: true, imageCount: true, studyInstanceUid: true },
      }),
    ]);
    return { patient, orders, studies };
  }

  async findDuplicates(organizationId: string | undefined, name: string, dob?: string, gender?: string) {
    return this.prisma.patient.findMany({
      where: {
        organizationId: organizationId ?? undefined,
        name: { equals: name, mode: 'insensitive' },
        ...(dob ? { dob: new Date(dob) } : {}),
        ...(gender ? { gender } : {}),
        status: { not: 'MERGED' },
      },
      take: 10,
    });
  }

  async create(user: AuthUser, dto: CreatePatientDto, ip?: string) {
    const organizationId = user.isSuperAdmin ? dto.organizationId : (user.organizationId ?? undefined);

    if (!dto.allowDuplicate) {
      const dups = await this.findDuplicates(organizationId, dto.name, dto.dob, dto.gender);
      if (dups.length > 0) {
        throw new ConflictException({
          message: 'Possible duplicate patient(s) found. Resubmit with allowDuplicate=true to override.',
          duplicates: dups.map((d) => ({ id: d.id, mrn: d.mrn, name: d.name })),
        });
      }
    }

    const mrn = dto.mrn ?? (await this.generateMrn(organizationId));
    const existing = await this.prisma.patient.findFirst({ where: { organizationId: organizationId ?? undefined, mrn } });
    if (existing) throw new ConflictException('Patient ID (MRN) already exists in this organization');

    const patient = await this.prisma.patient.create({
      data: {
        mrn, name: dto.name, dob: dto.dob ? new Date(dto.dob) : undefined,
        gender: dto.gender, mobile: dto.mobile, email: dto.email, address: dto.address,
        referringDoctorId: dto.referringDoctorId, organizationId, departmentId: dto.departmentId,
      },
    });
    await this.audit.log({ userId: user.id, action: 'PATIENT_CREATE', entityType: 'Patient', entityId: patient.id, detail: { mrn }, ip });
    return this.withAge(patient);
  }

  async update(user: AuthUser, id: string, dto: UpdatePatientDto, ip?: string) {
    await this.get(user, id);
    const patient = await this.prisma.patient.update({
      where: { id },
      data: { ...dto, dob: dto.dob ? new Date(dto.dob) : undefined },
    });
    await this.audit.log({ userId: user.id, action: 'PATIENT_UPDATE', entityType: 'Patient', entityId: id, detail: { ...dto }, ip });
    return this.withAge(patient);
  }

  async setStatus(user: AuthUser, id: string, status: string, ip?: string) {
    await this.get(user, id);
    const patient = await this.prisma.patient.update({ where: { id }, data: { status } });
    await this.audit.log({ userId: user.id, action: 'PATIENT_STATUS', entityType: 'Patient', entityId: id, detail: { status }, ip });
    return this.withAge(patient);
  }

  /** Merge source patient into target: move studies/orders, mark source MERGED. Audited. */
  async merge(user: AuthUser, targetId: string, sourceId: string, ip?: string) {
    if (targetId === sourceId) throw new BadRequestException('Cannot merge a patient into itself');
    const target = await this.get(user, targetId);
    const source = await this.get(user, sourceId);

    await this.prisma.$transaction([
      this.prisma.study.updateMany({ where: { patientId: sourceId }, data: { patientId: targetId } }),
      this.prisma.scheduledOrder.updateMany({ where: { patientId: sourceId }, data: { patientId: targetId } }),
      this.prisma.patient.update({ where: { id: sourceId }, data: { status: 'MERGED', mergedIntoId: targetId } }),
    ]);
    await this.audit.log({
      userId: user.id, action: 'PATIENT_MERGE', entityType: 'Patient', entityId: targetId,
      detail: { targetMrn: target.mrn, sourceMrn: source.mrn, sourceId }, ip,
    });
    return { success: true, targetId, sourceId };
  }
}
