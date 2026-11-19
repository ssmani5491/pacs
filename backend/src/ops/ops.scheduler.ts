import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import type Redis from 'ioredis';
import { HealthService, ServiceHealth } from './health.service';
import { AlertsService, AlertLevel } from './alerts.service';

/**
 * Background scheduler (Phase 8, Module G) — runs IN the backend process (no 9th
 * Docker service). Uses @nestjs/schedule for cadence and a Redis lock per job so
 * only one run executes at a time (idempotency / no overlap). Each run is
 * recorded in background_job_records with attempts + status + timing.
 *
 * Jobs:
 *  - HEALTHCHECK   (every 60s): probe services, persist results.
 *  - ALERT_EVAL    (after each healthcheck): raise alerts for DOWN services; auto-
 *    recover an alert only after N consecutive healthy checks (default 3).
 *  - NOTIF_CLEANUP (hourly): archive expired notifications.
 */
@Injectable()
export class OpsScheduler {
  private readonly log = new Logger('OpsScheduler');
  private readonly recoverThreshold: number;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    @Inject(REDIS) private redis: Redis,
    private health: HealthService,
    private alerts: AlertsService,
  ) {
    this.recoverThreshold = Number(this.config.get('ALERT_RECOVER_HEALTHY_CHECKS') ?? 3);
  }

  /** Acquire a short-lived Redis lock; returns false if another run holds it. */
  private async lock(key: string, ttlMs = 55000): Promise<boolean> {
    const res = await this.redis.set(`lock:job:${key}`, '1', 'PX', ttlMs, 'NX');
    return res === 'OK';
  }
  private async unlock(key: string) { try { await this.redis.del(`lock:job:${key}`); } catch { /* ignore */ } }

  private async record(jobType: string, fn: () => Promise<void>) {
    const rec = await this.prisma.backgroundJobRecord.create({ data: { jobType, status: 'RUNNING', attempts: 1, startedAt: new Date() } });
    try {
      await fn();
      await this.prisma.backgroundJobRecord.update({ where: { id: rec.id }, data: { status: 'SUCCESS', completedAt: new Date() } });
    } catch (e: any) {
      await this.prisma.backgroundJobRecord.update({ where: { id: rec.id }, data: { status: 'FAILED', completedAt: new Date(), error: String(e?.message).slice(0, 500) } });
      this.log.warn(`job ${jobType} failed: ${e?.message}`);
    }
  }

  @Interval('healthcheck', 60000)
  async healthcheckJob() {
    if (!(await this.lock('healthcheck'))) return;
    try {
      await this.record('HEALTHCHECK', async () => {
        const results = await this.health.checkAll(true);
        await this.evaluateAlerts(results);
      });
    } finally { await this.unlock('healthcheck'); }
  }

  /** Raise/recover infra alerts from health results with consecutive-check rule. */
  private async evaluateAlerts(results: ServiceHealth[]) {
    const levelFor = (service: string): AlertLevel =>
      ['postgres', 'orthanc', 'backend'].includes(service) ? 'CRITICAL' : 'HIGH';

    for (const r of results) {
      const key = `service:${r.service}:down`;
      if (r.status === 'DOWN') {
        await this.alerts.raise({
          alertKey: key, level: levelFor(r.service), source: 'HEALTHCHECK',
          title: `${r.service} is DOWN`, detail: r.detail,
        });
      } else if (r.status === 'HEALTHY') {
        // auto-recover only after N consecutive healthy checks
        const recent = await this.prisma.serviceHealthCheck.findMany({
          where: { service: r.service }, orderBy: { checkedAt: 'desc' }, take: this.recoverThreshold, select: { status: true },
        });
        if (recent.length >= this.recoverThreshold && recent.every((c) => c.status === 'HEALTHY')) {
          await this.alerts.recover(key);
        }
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupJob() {
    if (!(await this.lock('notif_cleanup', 300000))) return;
    try {
      await this.record('NOTIF_CLEANUP', async () => {
        const now = new Date();
        // 1) archive expired notifications
        await this.prisma.notification.updateMany({
          where: { archived: false, expiresAt: { not: null, lt: now } },
          data: { archived: true },
        });
        // 2) prune transient operational telemetry to prevent unbounded growth
        // (Phase 9 REL-1). These are NOT clinical/audit records: service health
        // samples and background-job run records. Retain the last 7 days.
        const retentionDays = Number(this.config.get('OPS_TELEMETRY_RETENTION_DAYS') ?? 7);
        const cutoff = new Date(now.getTime() - retentionDays * 86400000);
        await this.prisma.serviceHealthCheck.deleteMany({ where: { checkedAt: { lt: cutoff } } });
        await this.prisma.backgroundJobRecord.deleteMany({ where: { createdAt: { lt: cutoff } } });
      });
    } finally { await this.unlock('notif_cleanup'); }
  }
}
