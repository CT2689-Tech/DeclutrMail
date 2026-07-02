import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { EntitlementsModule } from '../common/entitlements/entitlements.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { FollowupController } from './followup.controller.js';
import { FollowupReadService } from './followup.read-service.js';

/**
 * FollowupModule (D84-D91) — read + dismiss surface for the Followups
 * Pro feature.
 *
 * Mirrors `SendersModule` / `AutopilotModule` (ADR-0008 / D201): thin
 * controller wired to a service that owns the SELECTs against
 * `followup_tracker` + the per-row dismiss mutation. Cross-feature
 * writes are not in scope here.
 *
 * Eager-loadable at boot — only needs DATABASE_URL (already global
 * via DbModule).
 */
@Module({
  imports: [AuthModule, MailboxAccountsModule, EntitlementsModule],
  controllers: [FollowupController],
  providers: [FollowupReadService],
  exports: [FollowupReadService],
})
export class FollowupModule {}
