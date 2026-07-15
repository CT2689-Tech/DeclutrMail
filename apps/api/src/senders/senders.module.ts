import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  createRedisConnection,
  RedisSnoozeLabelMapStore,
  SNOOZE_WAKE_QUEUE,
} from '@declutrmail/workers';
import type { SnoozeLabelMapStore, SnoozeWakeJobData } from '@declutrmail/workers';

import { AuthModule } from '../auth/auth.module.js';
import { EntitlementsModule } from '../common/entitlements/entitlements.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { SendersPolicyService } from './senders-policy.service.js';
import { SendersController } from './senders.controller.js';
import { SendersReadService } from './senders.read-service.js';
import { SnoozeService } from './snooze.service.js';
import { SnoozedController } from './snoozed.controller.js';
import { SnoozedReadService } from './snoozed.read-service.js';
import { SNOOZE_LABEL_MAP_TOKEN, SNOOZE_WAKE_QUEUE_TOKEN } from './snoozed.tokens.js';

/**
 * SendersModule (D39, D40, D42, D43, D44, D45, D46, D78–D80) — the
 * Senders feature surface.
 *
 * Per ADR-0008 / D201 the module skeleton mirrors `UndoModule`: a
 * thin controller wired to a read-only service that owns ALL the
 * SELECTs against the senders feature's tables (`senders`,
 * `sender_timeseries`, `sender_policies`) plus — per the documented
 * pragmatic exception — `triage_decisions` for the decision-history
 * endpoint.
 *
 * Write surface (D40, D42, D43): `SendersPolicyService` owns the
 * `sender_policies` standing-policy mutations (Keep / Protect)
 * behind `PATCH :id/policy`. The senders feature OWNS that table per
 * D204, so the upsert lives here directly — no outbox indirection
 * (contrast the actions feature's unsubscribe-intent, which publishes
 * an event for the senders-owned consumer).
 *
 * Snoozed surface (D78–D80): `SnoozedController` (+
 * `SnoozedReadService` / `SnoozeService`) lives HERE, not in its own
 * module, because both services operate exclusively on senders-owned
 * tables — the snooze timer columns are on `sender_policies` (D79).
 * Two infra providers back it, both fail-open on a missing REDIS_URL
 * (matches `ActionsModule`):
 *
 *   - the snooze-wake queue producer (wake-now enqueue), and
 *   - the Later-label-id mapping reader (the `SnoozeWakeWorker`
 *     publishes the per-mailbox Gmail label id to Redis; the list
 *     read consumes it — the HTTP process never talks to Gmail).
 *
 * Eager-loadable at boot — needs `DATABASE_URL` (global via DbModule);
 * Redis-backed routes degrade per their service docs without it.
 */
@Module({
  imports: [AuthModule, MailboxAccountsModule, EntitlementsModule],
  controllers: [SendersController, SnoozedController],
  providers: [
    SendersReadService,
    SendersPolicyService,
    SnoozedReadService,
    SnoozeService,
    {
      provide: SNOOZE_WAKE_QUEUE_TOKEN,
      useFactory: (): Queue<SnoozeWakeJobData> | null => {
        const url = process.env.REDIS_URL;
        if (!url) {
          return null;
        }
        return new Queue<SnoozeWakeJobData>(SNOOZE_WAKE_QUEUE, {
          connection: createRedisConnection(url),
        });
      },
    },
    {
      provide: SNOOZE_LABEL_MAP_TOKEN,
      useFactory: (): SnoozeLabelMapStore | null => {
        const url = process.env.REDIS_URL;
        if (!url) {
          return null;
        }
        return new RedisSnoozeLabelMapStore(createRedisConnection(url));
      },
    },
  ],
  exports: [SendersReadService],
})
export class SendersModule {}
