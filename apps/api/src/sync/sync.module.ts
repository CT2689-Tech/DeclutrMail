import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createRedisConnection, INITIAL_SYNC_QUEUE } from '@declutrmail/workers';
import type { InitialSyncJobData } from '@declutrmail/workers';

import { SyncController } from './sync.controller.js';
import { INITIAL_SYNC_QUEUE_TOKEN, SyncService } from './sync.service.js';

/**
 * SyncModule (D201) — owns the initial-sync queue producer.
 *
 * The BullMQ `Queue` is built eagerly from `REDIS_URL`. SyncModule is
 * imported only by `GoogleOAuthModule`, which itself loads only when
 * `GMAIL_CONNECT_ENABLED=true` — so a missing `REDIS_URL` cannot brick
 * API boot while the connect feature is off.
 *
 * The queue CONSUMER is a separate process (`apps/api/src/worker.ts`),
 * not part of this HTTP module.
 */
@Module({
  controllers: [SyncController],
  providers: [
    {
      provide: INITIAL_SYNC_QUEUE_TOKEN,
      useFactory: (): Queue<InitialSyncJobData> => {
        const url = process.env.REDIS_URL;
        if (!url) {
          throw new Error('REDIS_URL is not set — see .env.example.');
        }
        return new Queue<InitialSyncJobData>(INITIAL_SYNC_QUEUE, {
          connection: createRedisConnection(url),
        });
      },
    },
    SyncService,
  ],
  exports: [SyncService],
})
export class SyncModule {}
