import { Module } from '@nestjs/common';

import { ActionsModule } from '../actions/actions.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EntitlementsModule } from '../common/entitlements/entitlements.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { ScreenerController } from './screener.controller.js';
import { ScreenerReadService } from './screener.read-service.js';
import { ScreenerService } from './screener.service.js';

/**
 * ScreenerModule (D71–D77) — the soft-quarantine review surface for
 * first-time senders.
 *
 * Owns the queue/count reads over `screener_quarantine` and the decide
 * write (resolve a pending row after the verb executes). It does NOT
 * own the flag write — that lives in the ScoreWorker's Phase-B branch
 * (D75), nor any Gmail mutation — decisions delegate to
 * `ActionsService` (ActionsModule export) so the D226 lifecycle,
 * idempotency, and entitlement caps apply unchanged.
 */
@Module({
  imports: [AuthModule, MailboxAccountsModule, ActionsModule, EntitlementsModule],
  controllers: [ScreenerController],
  providers: [ScreenerService, ScreenerReadService],
  exports: [ScreenerService, ScreenerReadService],
})
export class ScreenerModule {}
