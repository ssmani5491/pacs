import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as net from 'net';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/current-user.decorator';
import { PaginationQuery, paginate, buildOrderBy, skipTake } from '../common/pagination';
import { orgScope } from '../common/tenant';
import { CreateModalityDto, UpdateModalityDto } from './dto';

const SORTABLE = ['name', 'aeTitle', 'modalityType', 'active', 'createdAt'];

@Injectable()
export class ModalitiesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async list(user: AuthUser, q: PaginationQuery) {
    const where: any = { ...orgScope(user) };
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { aeTitle: { contains: q.search, mode: 'insensitive' } },
        { modalityType: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.modalityDevice.findMany({ where, orderBy: buildOrderBy(q, SORTABLE, 'name'), ...skipTake(q) }),
      this.prisma.modalityDevice.count({ where }),
    ]);
    return paginate(data, total, q);
  }

  async get(user: AuthUser, id: string) {
    const m = await this.prisma.modalityDevice.findFirst({ where: { id, ...orgScope(user) } });
    if (!m) throw new NotFoundException('Modality not found');
    return m;
  }

  async create(user: AuthUser, dto: CreateModalityDto, ip?: string) {
    const dup = await this.prisma.modalityDevice.findFirst({ where: { aeTitle: dto.aeTitle } });
    if (dup) throw new ConflictException('AE Title already registered');
    const organizationId = user.isSuperAdmin ? dto.organizationId : (user.organizationId ?? undefined);
    const m = await this.prisma.modalityDevice.create({ data: { ...dto, organizationId } });
    await this.audit.log({ userId: user.id, action: 'MODALITY_CREATE', entityType: 'ModalityDevice', entityId: m.id, detail: { aeTitle: m.aeTitle }, ip });
    return m;
  }

  async update(user: AuthUser, id: string, dto: UpdateModalityDto, ip?: string) {
    await this.get(user, id);
    const m = await this.prisma.modalityDevice.update({ where: { id }, data: { ...dto } });
    await this.audit.log({ userId: user.id, action: 'MODALITY_UPDATE', entityType: 'ModalityDevice', entityId: id, detail: { ...dto }, ip });
    return m;
  }

  async setActive(user: AuthUser, id: string, active: boolean, ip?: string) {
    await this.get(user, id);
    const m = await this.prisma.modalityDevice.update({ where: { id }, data: { active } });
    await this.audit.log({ userId: user.id, action: 'MODALITY_STATUS', entityType: 'ModalityDevice', entityId: id, detail: { active }, ip });
    return m;
  }

  /**
   * TCP reachability check to the modality's host:port.
   * NOTE: this is a connectivity probe only. A true DICOM C-ECHO verification
   * lands in Phase 4 with the DICOM stack. Documented as a stub.
   */
  async testConnection(user: AuthUser, id: string): Promise<{ reachable: boolean; detail: string }> {
    const m = await this.get(user, id);
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const done = (reachable: boolean, detail: string) => {
        socket.destroy();
        resolve({ reachable, detail });
      };
      socket.setTimeout(3000);
      socket.once('connect', () => done(true, `TCP connect to ${m.host}:${m.port} OK (DICOM C-ECHO in Phase 4)`));
      socket.once('timeout', () => done(false, `Timeout connecting to ${m.host}:${m.port}`));
      socket.once('error', (e) => done(false, `Error: ${e.message}`));
      socket.connect(m.port, m.host);
    });
  }
}
