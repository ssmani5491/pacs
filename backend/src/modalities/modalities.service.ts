import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import * as net from 'net';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrthancService } from '../orthanc/orthanc.service';
import { AuthUser } from '../auth/current-user.decorator';
import { PaginationQuery, paginate, buildOrderBy, skipTake } from '../common/pagination';
import { orgScope } from '../common/tenant';
import { CreateModalityDto, UpdateModalityDto } from './dto';

const SORTABLE = ['name', 'aeTitle', 'modalityType', 'active', 'createdAt'];

export interface ModalityTestResult {
  // Distinct, specific outcomes — never a single generic "unreachable" string.
  outcome: 'ECHO_SUCCESS' | 'TCP_UNREACHABLE' | 'TCP_TIMEOUT' | 'ASSOCIATION_REJECTED' | 'ECHO_TIMEOUT' | 'ECHO_ERROR';
  detail: string;
  elapsedMs: number;
}

@Injectable()
export class ModalitiesService {
  private readonly log = new Logger('ModalitiesService');
  constructor(private prisma: PrismaService, private audit: AuditService, private orthanc: OrthancService) {}

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

  private tcpProbe(host: string, port: number, timeoutMs = 3000): Promise<{ ok: boolean; detail: string }> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const done = (ok: boolean, detail: string) => { socket.destroy(); resolve({ ok, detail }); };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done(true, `TCP connect to ${host}:${port} OK`));
      socket.once('timeout', () => done(false, `Timeout connecting to ${host}:${port}`));
      socket.once('error', (e) => done(false, `TCP error: ${e.message}`));
      socket.connect(port, host);
    });
  }

  /**
   * Real two-step connectivity test: a fast TCP reachability check, then — if
   * that succeeds — an actual DICOM C-ECHO through Orthanc's native SCU
   * (registers a temporary modality, echoes it, always deregisters it in a
   * finally block so a failed test never leaves a leftover /modalities entry
   * — see docs/DICOM_CONNECTIVITY_ROOT_CAUSE_ANALYSIS.md §8 item 4).
   * Returns one of a fixed set of specific outcomes; never a single generic
   * "unreachable" string regardless of what actually happened.
   */
  async testConnection(user: AuthUser, id: string): Promise<ModalityTestResult> {
    const m = await this.get(user, id);
    const t0 = Date.now();

    const tcp = await this.tcpProbe(m.host, m.port);
    if (!tcp.ok) {
      const outcome = /timeout/i.test(tcp.detail) ? 'TCP_TIMEOUT' : 'TCP_UNREACHABLE';
      return { outcome, detail: tcp.detail, elapsedMs: Date.now() - t0 };
    }

    const modId = `modtest_${m.id.slice(0, 8)}`;
    try {
      await this.orthanc.putModality(modId, m.aeTitle, m.host, m.port);
      const echo = await this.orthanc.echoModality(modId, 10);
      if (echo.ok) {
        return { outcome: 'ECHO_SUCCESS', detail: `C-ECHO successful (${echo.elapsedMs}ms)`, elapsedMs: Date.now() - t0 };
      }
      const outcome = echo.reason === 'timeout' ? 'ECHO_TIMEOUT' : echo.reason === 'rejected' ? 'ASSOCIATION_REJECTED' : 'ECHO_ERROR';
      return { outcome, detail: echo.detail ?? 'C-ECHO failed', elapsedMs: Date.now() - t0 };
    } catch (e: any) {
      this.log.warn(`testConnection(${id}): ${e?.message}`);
      return { outcome: 'ECHO_ERROR', detail: e?.message ?? 'Unknown error', elapsedMs: Date.now() - t0 };
    } finally {
      await this.orthanc.deleteModality(modId);
    }
  }
}
