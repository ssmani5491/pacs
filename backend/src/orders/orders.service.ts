import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';
import { PaginationQuery, paginate, buildOrderBy, skipTake } from '../common/pagination';
import { orgScope } from '../common/tenant';
import { CreateOrderDto, UpdateOrderDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';

const SORTABLE = ['accessionNumber', 'scheduledAt', 'status', 'priority', 'modalityType', 'createdAt'];

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  /** Unique accession number: YYYYMMDD + 6-digit daily sequence. */
  private async generateAccession(): Promise<string> {
    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayCount = await this.prisma.scheduledOrder.count({ where: { createdAt: { gte: start } } });
    let seq = todayCount + 1;
    for (let i = 0; i < 100; i++) {
      const acc = `${datePart}${String(seq).padStart(6, '0')}`;
      const exists = await this.prisma.scheduledOrder.findUnique({ where: { accessionNumber: acc } });
      if (!exists) return acc;
      seq++;
    }
    return `${datePart}${Date.now().toString().slice(-6)}`;
  }

  async list(user: AuthUser, q: PaginationQuery, status?: string) {
    const where: any = { ...orgScope(user) };
    if (status) where.status = status;
    if (q.search) {
      where.OR = [
        { accessionNumber: { contains: q.search, mode: 'insensitive' } },
        { procedureDesc: { contains: q.search, mode: 'insensitive' } },
        { patient: { is: { name: { contains: q.search, mode: 'insensitive' } } } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.scheduledOrder.findMany({
        where, orderBy: buildOrderBy(q, SORTABLE, 'scheduledAt'), ...skipTake(q),
        include: { patient: { select: { mrn: true, name: true } }, referringDoctor: { select: { name: true } } },
      }),
      this.prisma.scheduledOrder.count({ where }),
    ]);
    return paginate(data, total, q);
  }

  async get(user: AuthUser, id: string) {
    const o = await this.prisma.scheduledOrder.findFirst({
      where: { id, ...orgScope(user) },
      include: { patient: { select: { mrn: true, name: true } }, referringDoctor: { select: { name: true } } },
    });
    if (!o) throw new NotFoundException('Order not found');
    return o;
  }

  async create(user: AuthUser, dto: CreateOrderDto, ip?: string) {
    const organizationId = user.isSuperAdmin ? dto.organizationId : (user.organizationId ?? undefined);
    const patient = await this.prisma.patient.findFirst({ where: { id: dto.patientId, ...orgScope(user) } });
    if (!patient) throw new NotFoundException('Patient not found or out of scope');

    const accessionNumber = await this.generateAccession();
    const order = await this.prisma.scheduledOrder.create({
      data: {
        patientId: dto.patientId, accessionNumber, modalityType: dto.modalityType,
        procedureDesc: dto.procedureDesc, studyDescription: dto.studyDescription,
        clinicalHistory: dto.clinicalHistory, priority: dto.priority ?? 'ROUTINE',
        referringDoctorId: dto.referringDoctorId, assignedUserId: dto.assignedUserId,
        departmentId: dto.departmentId, organizationId: organizationId ?? patient.organizationId,
        scheduledAt: new Date(dto.scheduledAt),
      },
    });
    await this.audit.log({ userId: user.id, action: 'ORDER_CREATE', entityType: 'ScheduledOrder', entityId: order.id, detail: { accessionNumber }, ip });
    return order;
  }

  async update(user: AuthUser, id: string, dto: UpdateOrderDto, ip?: string) {
    await this.get(user, id);
    const order = await this.prisma.scheduledOrder.update({
      where: { id },
      data: { ...dto, scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined },
    });
    await this.audit.log({ userId: user.id, action: 'ORDER_UPDATE', entityType: 'ScheduledOrder', entityId: id, detail: { ...dto }, ip });
    return order;
  }

  async cancel(user: AuthUser, id: string, ip?: string) {
    await this.get(user, id);
    const order = await this.prisma.scheduledOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log({ userId: user.id, action: 'ORDER_CANCEL', entityType: 'ScheduledOrder', entityId: id, ip });
    await this.notifications.create({
      category: 'EXAM_CANCELLED', priority: 'NORMAL', roleKey: 'radiologist',
      organizationId: order.organizationId, orderId: order.id,
      dedupKey: `order-cancel:${order.id}`,
      title: 'Examination cancelled',
      body: `Order ${order.accessionNumber ?? order.id} was cancelled.`,
      link: '/orders',
    });
    return order;
  }

  async assign(user: AuthUser, id: string, assignedUserId: string, ip?: string) {
    await this.get(user, id);
    const order = await this.prisma.scheduledOrder.update({ where: { id }, data: { assignedUserId } });
    await this.audit.log({ userId: user.id, action: 'ORDER_ASSIGN', entityType: 'ScheduledOrder', entityId: id, detail: { assignedUserId }, ip });
    await this.notifications.create({
      category: 'EXAM_ASSIGNED', priority: 'NORMAL', userId: assignedUserId,
      organizationId: order.organizationId, orderId: order.id,
      dedupKey: `order-assign:${order.id}:${assignedUserId}`,
      title: 'Examination assigned to you',
      body: `You were assigned order ${order.accessionNumber ?? order.id}.`,
      link: '/reporting',
    });
    return order;
  }
}
