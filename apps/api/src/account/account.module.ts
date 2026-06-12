import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import { createRedisConnection, EMAIL_SEND_QUEUE } from '@declutrmail/workers';
import type { EmailSendJobData } from '@declutrmail/workers';

import { AuthModule } from '../auth/auth.module.js';
import { SecurityEventsModule } from '../security-events/security-events.module.js';
import { UndoModule } from '../undo/undo.module.js';
import { AccountController } from './account.controller.js';
import { AccountDeletionOrchestrator, DELETION_EMAIL_QUEUE_TOKEN } from './deletion.service.js';

/**
 * AccountModule (D205 + D216 + D232).
 *
 * Hosts `AccountDeletionOrchestrator` — the D205 orchestrator that owns
 * the `account_deletion_requests` lifecycle (request / status / cancel)
 * — and its HTTP surface (`AccountController`, `/account/deletion`).
 *
 * The purge itself runs in the worker process
 * (`packages/workers/src/deletion.worker.ts`, cron sweep); this module
 * only persists intent + reads status.
 *
 * Imports:
 *   - `UndoModule` — `activeExpirySummaryForUser` for the D232 per-USER
 *     undo aggregate.
 *   - `SecurityEventsModule` — audit rows on request/cancel.
 *   - `AuthModule` — `JwtGuard` / `CsrfGuard` for the controller.
 *
 * The email-send queue producer is fail-open (matches ActionsModule):
 * without `REDIS_URL` the factory returns null and the orchestrator
 * logs-and-skips the scheduled email instead of failing the request.
 */
@Module({
  imports: [AuthModule, UndoModule, SecurityEventsModule],
  controllers: [AccountController],
  providers: [
    {
      provide: DELETION_EMAIL_QUEUE_TOKEN,
      useFactory: (): Queue<EmailSendJobData> | null => {
        const url = process.env.REDIS_URL;
        if (!url) {
          return null;
        }
        return new Queue<EmailSendJobData>(EMAIL_SEND_QUEUE, {
          connection: createRedisConnection(url),
        });
      },
    },
    AccountDeletionOrchestrator,
  ],
  exports: [AccountDeletionOrchestrator],
})
export class AccountModule {}
