import { Module, forwardRef } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  createRedisConnection,
  INCREMENTAL_SYNC_QUEUE,
  INITIAL_SYNC_QUEUE,
} from '@declutrmail/workers';
import type { IncrementalSyncJobData, InitialSyncJobData } from '@declutrmail/workers';

import { AuthModule } from '../auth/auth.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { SyncController } from './sync.controller.js';
import {
  INCREMENTAL_SYNC_QUEUE_TOKEN,
  INITIAL_SYNC_QUEUE_TOKEN,
  SyncService,
} from './sync.service.js';

/**
 * SyncModule (D201, D109, D224) — owns BOTH sync-queue producers + the
 * sync-gate status transport.
 *
 * Queues:
 *   - INITIAL_SYNC_QUEUE     — one-shot backfill on connect (D109).
 *   - INCREMENTAL_SYNC_QUEUE — delta jobs from Pub/Sub pushes (D8, D229)
 *     AND from the user-facing "Sync now" button / 5-min reconciliation
 *     cron (D38 prod-ready pass). One Queue producer instance per
 *     process, shared between webhook + controller + cron — exported
 *     so WebhooksModule can inject without registering its own.
 *
 * The BullMQ `Queue` providers are eager from `REDIS_URL`. SyncModule
 * is imported by:
 *   - AuthModule  (orchestrator enqueues the initial sync on connect)
 *   - WebhooksModule  (webhook service enqueues incrementals)
 * and exposes `SyncController` for the onboarding gate + the new
 * `POST /api/v1/sync/incremental` route, guarded by `JwtGuard` +
 * `CurrentMailboxGuard`.
 *
 * `forwardRef(AuthModule)` breaks the cycle:
 *   AuthModule → SyncModule (orchestrator enqueues sync)
 *   SyncModule → AuthModule (controller uses JwtGuard)
 * Both are eagerly loaded, so the forwardRef resolves once Nest
 * finishes wiring both.
 *
 * The queue CONSUMERS are a separate process (`apps/api/src/worker.ts`),
 * not part of this HTTP module.
 */
@Module({
  imports: [forwardRef(() => AuthModule), MailboxAccountsModule],
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
    {
      provide: INCREMENTAL_SYNC_QUEUE_TOKEN,
      useFactory: (): Queue<IncrementalSyncJobData> => {
        const url = process.env.REDIS_URL;
        if (!url) {
          throw new Error('REDIS_URL is not set — see .env.example.');
        }
        return new Queue<IncrementalSyncJobData>(INCREMENTAL_SYNC_QUEUE, {
          connection: createRedisConnection(url),
        });
      },
    },
    SyncService,
  ],
  exports: [SyncService, INITIAL_SYNC_QUEUE_TOKEN, INCREMENTAL_SYNC_QUEUE_TOKEN],
})
export class SyncModule {}
