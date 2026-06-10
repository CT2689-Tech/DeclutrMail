import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { SendersPolicyService } from './senders-policy.service.js';
import { SendersController } from './senders.controller.js';
import { SendersReadService } from './senders.read-service.js';

/**
 * SendersModule (D39, D40, D42, D43, D44, D45, D46) — the Senders
 * feature surface.
 *
 * Per ADR-0008 / D201 the module skeleton mirrors `UndoModule`: a
 * thin controller wired to a read-only service that owns ALL the
 * SELECTs against the senders feature's tables (`senders`,
 * `sender_timeseries`, `sender_policies`) plus — per the documented
 * pragmatic exception — `triage_decisions` for the decision-history
 * endpoint.
 *
 * Write surface (D40, D42, D43): `SendersPolicyService` owns the
 * `sender_policies` standing-policy mutations (Keep / VIP / Protect)
 * behind `PATCH :id/policy`. The senders feature OWNS that table per
 * D204, so the upsert lives here directly — no outbox indirection
 * (contrast the actions feature's unsubscribe-intent, which publishes
 * an event for the senders-owned consumer).
 *
 * Eager-loadable at boot — only needs `DATABASE_URL`, already global
 * via DbModule.
 */
@Module({
  imports: [AuthModule, MailboxAccountsModule],
  controllers: [SendersController],
  providers: [SendersReadService, SendersPolicyService],
  exports: [SendersReadService],
})
export class SendersModule {}
