import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import { createRedisConnection, SCORE_QUEUE } from '@declutrmail/workers';
import type { ScoreJobData } from '@declutrmail/workers';

import { TriageController } from './triage.controller.js';
import { SCORE_QUEUE_TOKEN, TriageService } from './triage.service.js';

/**
 * TriageModule (D201, D204) — owns the read facade for the decision
 * engine and the producer side of the score-trigger queue.
 *
 * Mirrors `SyncModule`'s shape: BullMQ `Queue` built eagerly from
 * `REDIS_URL`, exported alongside the service. The queue CONSUMER
 * (`ScoreWorker`) lives in the separate worker process; this module
 * only enqueues.
 *
 * `REDIS_URL` is read at provider-factory time, not at module-class
 * decoration time, so a missing env doesn't break unrelated test
 * harnesses that construct the module without the queue.
 */
@Module({
  controllers: [TriageController],
  providers: [
    {
      provide: SCORE_QUEUE_TOKEN,
      useFactory: (): Queue<ScoreJobData> => {
        const url = process.env.REDIS_URL;
        if (!url) {
          throw new Error('REDIS_URL is not set — see .env.example.');
        }
        return new Queue<ScoreJobData>(SCORE_QUEUE, {
          connection: createRedisConnection(url),
        });
      },
    },
    TriageService,
  ],
  exports: [TriageService],
})
export class TriageModule {}
