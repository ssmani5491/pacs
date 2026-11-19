import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { REDIS } from '../redis/redis.module';
import type Redis from 'ioredis';
import { StorageService } from './storage.service';

/**
 * Captures a daily storage snapshot (real measurements) for growth tracking,
 * forecasting, and threshold-alert evaluation. Redis-locked so only one backend
 * captures per day. Admins can also trigger a snapshot on demand via the API.
 */
@Injectable()
export class StorageScheduler {
  private readonly log = new Logger('StorageScheduler');
  constructor(@Inject(REDIS) private redis: Redis, private svc: StorageService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async dailySnapshot() {
    // Lock with a 1-day key so a restart on the same day doesn't double-capture.
    const day = new Date().toISOString().slice(0, 10);
    const res = await this.redis.set(`lock:storage-snapshot:${day}`, '1', 'PX', 23 * 3600 * 1000, 'NX');
    if (res !== 'OK') return;
    try { await this.svc.captureSnapshot('scheduled-daily'); }
    catch (e: any) { this.log.warn(`daily snapshot: ${e?.message}`); }
  }
}
