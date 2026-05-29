import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import { createRedisConnection, LABEL_ACTION_QUEUE } from '@declutrmail/workers';
import type { LabelActionJobData } from '@declutrmail/workers';

import { AuthModule } from '../auth/auth.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { ActionsController } from './actions.controller.js';
import { ACTION_QUEUE_TOKEN, ActionsService } from './actions.service.js';

/**
 * ActionsModule (D226) — producer side of the async destructive-action
 * pipeline. Owns the `action_jobs` write surface + the label-action
 * queue producer.
 *
 * The queue CONSUMER (`LabelActionWorker`) lives in the worker process;
 * this module only enqueues. Queue construction is fail-open (matches
 * TriageModule): when `REDIS_URL` is absent the factory returns `null`,
 * so `GET /api/actions/:id` stays reachable and only the enqueue paths
 * surface a clear error.
 *
 * Exports `ActionsService` so `UndoModule` can enqueue reverse (undo)
 * jobs through the same pipeline.
 */
@Module({
  imports: [AuthModule, MailboxAccountsModule],
  controllers: [ActionsController],
  providers: [
    {
      provide: ACTION_QUEUE_TOKEN,
      useFactory: (): Queue<LabelActionJobData> | null => {
        const url = process.env.REDIS_URL;
        if (!url) {
          return null;
        }
        return new Queue<LabelActionJobData>(LABEL_ACTION_QUEUE, {
          connection: createRedisConnection(url),
        });
      },
    },
    ActionsService,
  ],
  exports: [ActionsService],
})
export class ActionsModule {}
