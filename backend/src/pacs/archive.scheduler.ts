import { Injectable, Inject, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { REDIS } from '../redis/redis.module';
import type Redis from 'ioredis';
import { ArchiveService } from './archive.service';

/** Drives the archive-compression executor (Module 2). Redis-locked so only one
 * backend runs a compression job at a time (idempotency / no overlap). */
@Injectable()
export class ArchiveScheduler {
  private readonly log = new Logger('ArchiveScheduler');
  constructor(@Inject(REDIS) private redis: Redis, private svc: ArchiveService) {}

  @Interval('archive-exec', 6000)
  async tick() {
    // Recovery runs OUTSIDE the execution lock (idempotent + read-mostly), so a
    // stale lock left by a crashed process cannot stall recovery of stuck jobs.
    try { await this.svc.recover(); } catch (e: any) { this.log.warn(`archive recover: ${e?.message}`); }

    // Execution lock: shorter TTL so a crash frees it quickly; refreshed each run.
    const res = await this.redis.set('lock:job:archive', '1', 'PX', 60000, 'NX');
    if (res !== 'OK') return;
    try {
      for (let i = 0; i < 2; i++) { const did = await this.svc.runNextQueuedJob(); if (!did) break; }
    } catch (e: any) { this.log.warn(`archive tick: ${e?.message}`); }
    finally { try { await this.redis.del('lock:job:archive'); } catch { /* ignore */ } }
  }
}
