import { Module } from '@nestjs/common';

import { SendersController } from './senders.controller.js';
import { SendersReadService } from './senders.read-service.js';

/**
 * SendersModule (D39, D40, D44, D45, D46) — read-side surface for the
 * Senders feature.
 *
 * Per ADR-0008 / D201 the module skeleton mirrors `UndoModule`: a
 * thin controller wired to a read-only service that owns ALL the
 * SELECTs against the senders feature's tables (`senders`,
 * `sender_timeseries`, `sender_policies`) plus — per the documented
 * pragmatic exception — `triage_decisions` for the decision-history
 * endpoint.
 *
 * No write surface yet: the standing-policy mutations (mark VIP,
 * Protect, etc.) land with their feature slices and emit domain
 * events that the senders read service projects (D204).
 *
 * Eager-loadable at boot — only needs `DATABASE_URL`, already global
 * via DbModule.
 */
@Module({
  controllers: [SendersController],
  providers: [SendersReadService],
  exports: [SendersReadService],
})
export class SendersModule {}
