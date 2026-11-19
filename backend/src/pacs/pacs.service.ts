import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrthancService } from '../orthanc/orthanc.service';
import { AuthUser } from '../auth/current-user.decorator';
import { orgScope } from '../common/tenant';
import { PaginationQuery, paginate, skipTake } from '../common/pagination';

@Injectable()
export class PacsService {
  constructor(private prisma: PrismaService, private orthanc: OrthancService) {}

  // PACS monitoring dashboard: Orthanc health + storage + reception summary.
  async monitor() {
    const health = await this.orthanc.health();
    let stats: any = null;
    if (health.up) {
      stats = await this.orthanc.statistics().catch(() => null);
    }
    const [received, ingested, orphan, failed, duplicate] = await this.prisma.$transaction([
      this.prisma.dicomReceptionLog.count(),
      this.prisma.dicomReceptionLog.count({ where: { status: { in: ['INGESTED', 'MATCHED'] } } }),
      this.prisma.dicomReceptionLog.count({ where: { status: 'ORPHAN' } }),
      this.prisma.dicomReceptionLog.count({ where: { status: 'FAILED' } }),
      this.prisma.dicomReceptionLog.count({ where: { status: 'DUPLICATE' } }),
    ]);
    return {
      orthanc: health,
      storage: stats ? {
        countStudies: stats.CountStudies, countSeries: stats.CountSeries,
        countInstances: stats.CountInstances,
        totalDiskSizeMB: stats.TotalDiskSizeMB ?? Math.round((stats.TotalDiskSize ?? 0) / 1048576),
      } : null,
      reception: { received, ingested, orphan, failed, duplicate },
      generatedAt: new Date().toISOString(),
    };
  }

  async receptionLogs(q: PaginationQuery, status?: string) {
    const where: any = {};
    if (status) where.status = status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.dicomReceptionLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.dicomReceptionLog.count({ where }),
    ]);
    return paginate(data, total, q);
  }

  // MWL monitoring: query counts, last query, per-calling-AE stats.
  async mwlMonitor() {
    const [total, success, noMatch, failed, rejected, lastQuery, byAet] =
      await this.prisma.$transaction([
        this.prisma.mwlQueryLog.count(),
        this.prisma.mwlQueryLog.count({ where: { status: 'SUCCESS' } }),
        this.prisma.mwlQueryLog.count({ where: { status: 'NO_MATCH' } }),
        this.prisma.mwlQueryLog.count({ where: { status: 'FAILED' } }),
        this.prisma.mwlQueryLog.count({ where: { status: 'REJECTED' } }),
        this.prisma.mwlQueryLog.findFirst({ orderBy: { createdAt: 'desc' } }),
        this.prisma.mwlQueryLog.groupBy({ by: ['callingAet'], _count: { _all: true }, orderBy: { callingAet: 'asc' } }),
      ]);
    return {
      total, success, noMatch, failed, rejected,
      lastQueryAt: lastQuery?.createdAt ?? null,
      byCallingAet: byAet.map((a: any) => ({ callingAet: a.callingAet ?? '(unknown)', count: a._count._all })),
      generatedAt: new Date().toISOString(),
    };
  }

  async mwlLogs(q: PaginationQuery, status?: string) {
    const where: any = {};
    if (status) where.status = status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.mwlQueryLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.mwlQueryLog.count({ where }),
    ]);
    return paginate(data, total, q);
  }

  async modalityStatus(user: AuthUser) {
    return this.prisma.modalityDevice.findMany({
      where: { ...orgScope(user) },
      select: {
        id: true, name: true, aeTitle: true, host: true, port: true, modalityType: true,
        active: true, lastSuccessAt: true, lastFailureAt: true,
      },
      orderBy: { name: 'asc' },
    });
  }
}
