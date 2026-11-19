import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { REDIS } from '../redis/redis.module';
import type Redis from 'ioredis';
import { BackupService } from './backup.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Nightly backup scheduler (Product Validation Phase 1D). Registers a dynamic
 * cron job (time configurable via BACKUP_CRON, default 02:00) rather than a
 * fixed @Cron decorator, since the implementation brief requires the schedule
 * to be configurable. Redis-locked exactly like OpsScheduler/StorageScheduler
 * so a restart or multi-instance deploy can never run two nightly backups
 * concurrently.
 */
@Injectable()
export class BackupScheduler implements OnModuleInit {
  private readonly log = new Logger('BackupScheduler');

  constructor(
    private config: ConfigService,
    private scheduler: SchedulerRegistry,
    @Inject(REDIS) private redis: Redis,
    private backup: BackupService,
    private prisma: PrismaService,
  ) {}

  onModuleInit() {
    const cronExpr = this.config.get<string>('BACKUP_CRON') ?? '0 2 * * *';
    const job = new CronJob(cronExpr, () => this.runLocked());
    this.scheduler.addCronJob('backup-nightly', job as any);
    job.start();
    this.log.log(`nightly backup job registered (cron: ${cronExpr})`);
  }

  private async runLocked() {
    // Lock keyed by calendar day so a backend restart on the same day never
    // double-runs the nightly backup (prevent overlapping/concurrent runs).
    const day = new Date().toISOString().slice(0, 10);
    const res = await this.redis.set(`lock:job:backup-nightly:${day}`, '1', 'PX', 23 * 3600 * 1000, 'NX');
    if (res !== 'OK') { this.log.log('nightly backup already ran today (lock held) — skipping'); return; }

    const jobRecord = await this.prisma.backgroundJobRecord.create({
      data: { jobType: 'BACKUP_NIGHTLY', status: 'RUNNING', attempts: 1, startedAt: new Date() },
    });
    try {
      const result = await this.backup.runNightly();
      const anyFailed = result.results.some((r) => !r.ok);
      await this.prisma.backgroundJobRecord.update({
        where: { id: jobRecord.id },
        data: { status: anyFailed ? 'FAILED' : 'SUCCESS', completedAt: new Date(), error: anyFailed ? 'one or more backup components failed — see backup_runs' : null },
      });
    } catch (e: any) {
      await this.prisma.backgroundJobRecord.update({
        where: { id: jobRecord.id },
        data: { status: 'FAILED', completedAt: new Date(), error: String(e?.message).slice(0, 500) },
      });
      this.log.error(`nightly backup run failed: ${e?.message}`);
    }
  }
}
