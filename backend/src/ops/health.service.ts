import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import type Redis from 'ioredis';
import * as net from 'net';

export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
export interface ServiceHealth {
  service: string; status: HealthStatus; responseMs: number | null; detail?: string;
  lastSuccessAt?: Date | null; lastFailureAt?: Date | null;
}

const SERVICES = ['backend', 'postgres', 'redis', 'orthanc', 'dicom-cstore', 'mwl-scp', 'ohif', 'nginx'];

/**
 * Application-level service health (Phase 8, Module E). Uses actual connectivity
 * / app checks — NOT "docker container is running". Results are persisted to
 * service_health_checks so last success/failure + trends are available.
 */
@Injectable()
export class HealthService {
  private readonly log = new Logger('HealthService');

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    @Inject(REDIS) private redis: Redis,
  ) {}

  private tcpProbe(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = new net.Socket();
      let done = false;
      const finish = (ok: boolean) => { if (!done) { done = true; sock.destroy(); resolve(ok); } };
      sock.setTimeout(timeoutMs);
      sock.once('connect', () => finish(true));
      sock.once('timeout', () => finish(false));
      sock.once('error', () => finish(false));
      sock.connect(port, host);
    });
  }

  private async httpProbe(url: string, auth?: string, okCodes = [200, 401]): Promise<{ ok: boolean; detail?: string }> {
    try {
      const headers: Record<string, string> = {};
      if (auth) headers['Authorization'] = auth;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
      return { ok: okCodes.includes(res.status), detail: `HTTP ${res.status}` };
    } catch (e: any) {
      return { ok: false, detail: e?.message };
    }
  }

  private async checkOne(service: string): Promise<ServiceHealth> {
    const t0 = Date.now();
    let status: HealthStatus = 'UNKNOWN';
    let detail: string | undefined;
    try {
      switch (service) {
        case 'backend':
          status = 'HEALTHY'; detail = 'self'; break;
        case 'postgres':
          await this.prisma.$queryRaw`SELECT 1`; status = 'HEALTHY'; break;
        case 'redis': {
          const pong = await this.redis.ping(); status = pong === 'PONG' ? 'HEALTHY' : 'DEGRADED'; break;
        }
        case 'orthanc': {
          const user = this.config.get<string>('ORTHANC_USERNAME') ?? 'orthanc';
          const pass = this.config.get<string>('ORTHANC_PASSWORD') ?? '';
          const base = (this.config.get<string>('ORTHANC_URL') ?? 'http://orthanc:8042').replace(/\/$/, '');
          const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
          const r = await this.httpProbe(`${base}/system`, auth, [200]);
          status = r.ok ? 'HEALTHY' : 'DOWN'; detail = r.detail; break;
        }
        case 'dicom-cstore': {
          const ok = await this.tcpProbe('orthanc', 4242); status = ok ? 'HEALTHY' : 'DOWN'; break;
        }
        case 'mwl-scp': {
          const ok = await this.tcpProbe('mwl-scp', Number(this.config.get('MWL_PORT') ?? 4243));
          status = ok ? 'HEALTHY' : 'DOWN'; break;
        }
        case 'ohif': {
          const r = await this.httpProbe('http://ohif:80/viewer/', undefined, [200]);
          status = r.ok ? 'HEALTHY' : 'DOWN'; detail = r.detail; break;
        }
        case 'nginx': {
          const r = await this.httpProbe('http://nginx:80/healthz', undefined, [200]);
          status = r.ok ? 'HEALTHY' : 'DOWN'; detail = r.detail; break;
        }
      }
    } catch (e: any) {
      status = 'DOWN'; detail = e?.message;
    }
    const responseMs = Date.now() - t0;
    return { service, status, responseMs, detail };
  }

  /** Run all checks, persist results, return them with last success/failure. */
  async checkAll(persist = true): Promise<ServiceHealth[]> {
    const results = await Promise.all(SERVICES.map((s) => this.checkOne(s)));
    if (persist) {
      try {
        await this.prisma.serviceHealthCheck.createMany({
          data: results.map((r) => ({ service: r.service, status: r.status, responseMs: r.responseMs, detail: r.detail })),
        });
      } catch (e: any) { this.log.warn(`persist health failed: ${e?.message}`); }
    }
    // attach last success/failure timestamps
    for (const r of results) {
      const [lastSuccess, lastFailure] = await Promise.all([
        this.prisma.serviceHealthCheck.findFirst({ where: { service: r.service, status: 'HEALTHY' }, orderBy: { checkedAt: 'desc' }, select: { checkedAt: true } }),
        this.prisma.serviceHealthCheck.findFirst({ where: { service: r.service, status: { in: ['DOWN', 'DEGRADED'] } }, orderBy: { checkedAt: 'desc' }, select: { checkedAt: true } }),
      ]);
      r.lastSuccessAt = lastSuccess?.checkedAt ?? null;
      r.lastFailureAt = lastFailure?.checkedAt ?? null;
    }
    return results;
  }

  /** Latest known status per service without running fresh probes (cheap read). */
  async latest(): Promise<ServiceHealth[]> {
    const out: ServiceHealth[] = [];
    for (const service of SERVICES) {
      const last = await this.prisma.serviceHealthCheck.findFirst({ where: { service }, orderBy: { checkedAt: 'desc' } });
      const [lastSuccess, lastFailure] = await Promise.all([
        this.prisma.serviceHealthCheck.findFirst({ where: { service, status: 'HEALTHY' }, orderBy: { checkedAt: 'desc' }, select: { checkedAt: true } }),
        this.prisma.serviceHealthCheck.findFirst({ where: { service, status: { in: ['DOWN', 'DEGRADED'] } }, orderBy: { checkedAt: 'desc' }, select: { checkedAt: true } }),
      ]);
      out.push({
        service,
        status: (last?.status as HealthStatus) ?? 'UNKNOWN',
        responseMs: last?.responseMs ?? null,
        detail: last?.detail ?? undefined,
        lastSuccessAt: lastSuccess?.checkedAt ?? null,
        lastFailureAt: lastFailure?.checkedAt ?? null,
      });
    }
    return out;
  }
}

export { SERVICES };
