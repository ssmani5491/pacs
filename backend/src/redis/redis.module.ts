import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS = 'REDIS_CLIENT';

/**
 * Shared Redis client (Phase 8). Previously Redis was instantiated inline only
 * in auth.service; this exposes a single global client for job locks, dedup, and
 * lightweight coordination. Auth keeps its own client (unchanged) to avoid any
 * risk to the refresh-token flow.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('REDIS_HOST'),
          port: Number(config.get<string>('REDIS_PORT')),
          password: config.get<string>('REDIS_PASSWORD'),
          lazyConnect: false,
          maxRetriesPerRequest: 2,
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
