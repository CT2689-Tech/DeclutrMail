import { Module, forwardRef } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createRedisConnection, INITIAL_SYNC_QUEUE } from '@declutrmail/workers';
import type { InitialSyncJobData } from '@declutrmail/workers';

import { AuthModule } from '../auth/auth.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { SyncController } from './sync.controller.js';
import { INITIAL_SYNC_QUEUE_TOKEN, SyncService } from './sync.service.js';

/**
 * SyncModule (D201, D109, D224) — owns the initial-sync queue producer
 * + the sync-gate status transport.
 *
 * The BullMQ `Queue` is built eagerly from `REDIS_URL`. SyncModule is
 * imported by `AuthModule` (the orchestrator enqueues the initial sync
 * on connect) and exposes `SyncController` for the onboarding gate,
 * guarded by `JwtGuard` + `CurrentMailboxGuard`.
 *
 * `forwardRef(AuthModule)` breaks the cycle:
 *   AuthModule → SyncModule (orchestrator enqueues sync)
 *   SyncModule → AuthModule (controller uses JwtGuard)
 * Both are eagerly loaded, so the forwardRef resolves once Nest
 * finishes wiring both.
 *
 * The queue CONSUMER is a separate process (`apps/api/src/worker.ts`),
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
    SyncService,
  ],
  exports: [SyncService],
})
export class SyncModule {}
