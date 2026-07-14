import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import { createRedisConnection, SCORE_QUEUE } from '@declutrmail/workers';
import type { ScoreJobData } from '@declutrmail/workers';

import { AuthModule } from '../auth/auth.module.js';
import { EntitlementsModule } from '../common/entitlements/entitlements.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { TriageController } from './triage.controller.js';
import { TriageReadService } from './triage.read-service.js';
import { SCORE_QUEUE_TOKEN, TriageService } from './triage.service.js';

/**
 * TriageModule (D201, D204) — owns the read facade for the decision
 * engine and the producer side of the score-trigger queue.
 *
 * Queue construction is fail-open per the same pattern `RateLimitModule`
 * documents at `apps/api/src/app.module.ts:53`: when `REDIS_URL` is
 * absent (local dev without Redis, throwaway test harnesses that don't
 * exercise the producer path), the factory returns `null` instead of
 * throwing. The read-only `GET /triage/queue-size` route is then still
 * reachable, and only callers that try to ENQUEUE
 * (`TriageService.scoreSender`) see the clear runtime error pointing
 * at the missing env. Without this, importing `TriageModule` from
 * `AppModule` would brick every dev API boot that omits `REDIS_URL`.
 *
 * The queue CONSUMER (`ScoreWorker`) lives in the separate worker
 * process; this module only enqueues. `REDIS_URL` is read at
 * provider-factory time, not at module-class decoration time, so a
 * missing env doesn't break unrelated test harnesses that construct
 * the module without the queue.
 */
@Module({
  imports: [AuthModule, MailboxAccountsModule, EntitlementsModule],
  controllers: [TriageController],
  providers: [
    {
      provide: SCORE_QUEUE_TOKEN,
      useFactory: (): Queue<ScoreJobData> | null => {
        const url = process.env.REDIS_URL;
        if (!url) {
          return null;
        }
        return new Queue<ScoreJobData>(SCORE_QUEUE, {
          connection: createRedisConnection(url),
        });
      },
    },
    TriageService,
    TriageReadService,
  ],
  exports: [TriageService, TriageReadService],
})
export class TriageModule {}
