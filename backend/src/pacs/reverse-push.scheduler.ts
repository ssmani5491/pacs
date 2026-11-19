import { Injectable, Inject, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { REDIS } from '../redis/redis.module';
import type Redis from 'ioredis';
import { ReversePushService } from './reverse-push.service';

/**
 * Drives the DICOM reverse-push executor (Module 1). Every few seconds it takes a
 * Redis lock (so only one backend instance runs a job at a time — idempotency /
 * no duplicate execution) and asks the service to run the next QUEUED job. The
 * actual C-STORE is done by Orthanc's native SCU inside the service.
 */
@Injectable()
export class ReversePushScheduler {
  private readonly log = new Logger('ReversePushScheduler');

  constructor(
    @Inject(REDIS) private redis: Redis,
    private svc: ReversePushService,
  ) {}

  @Interval('reverse-push-exec', 5000)
  async tick() {
    // Lock TTL comfortably longer than one poll cycle; released in finally.
    const res = await this.redis.set('lock:job:reverse-push', '1', 'PX', 120000, 'NX');
    if (res !== 'OK') return;
    try {
      // Process at most a few jobs per tick to avoid starving the event loop.
      for (let i = 0; i < 3; i++) {
        const did = await this.svc.runNextQueuedJob();
        if (!did) break;
      }
    } catch (e: any) {
      this.log.warn(`reverse-push tick failed: ${e?.message}`);
    } finally {
      try { await this.redis.del('lock:job:reverse-push'); } catch { /* ignore */ }
    }
  }
}
