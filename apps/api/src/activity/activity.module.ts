import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { ActivityController } from './activity.controller.js';
import { ActivityReadService } from './activity.read-service.js';

/**
 * ActivityModule (D55-D60, tracer-bullet).
 *
 * Mirrors `FollowupModule` / `BriefModule` (ADR-0008 / D201): thin
 * controller wired to a read service that owns the SELECT against
 * `activity_log` + its joins to `senders` and `undo_journal`.
 * Cross-feature writes are intentionally not in scope here — the
 * activity_log writers live in their respective feature modules
 * (label-action worker writes manual-archive rows, followup read-service
 * writes followup-dismiss rows, etc.).
 *
 * Eager-loadable at boot — only needs DATABASE_URL (already global
 * via DbModule).
 */
@Module({
  imports: [AuthModule, MailboxAccountsModule],
  controllers: [ActivityController],
  providers: [ActivityReadService],
  exports: [ActivityReadService],
})
export class ActivityModule {}
