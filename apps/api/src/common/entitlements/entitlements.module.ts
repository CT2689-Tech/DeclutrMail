import { Module } from '@nestjs/common';

import { EntitlementsService } from './entitlements.service.js';
import { InboxLimitGuard } from './inbox-limit.guard.js';

/**
 * EntitlementsModule (D19, D77, D81) — server-side tier enforcement.
 *
 * Exposes `EntitlementsService` (free-cleanup-cap + inbox-limit gates +
 * the `/api/auth/me` quota summary) and `InboxLimitGuard` (the
 * connect-mailbox OAuth start gate). DB access rides the global
 * `DRIZZLE` provider.
 */
@Module({
  providers: [EntitlementsService, InboxLimitGuard],
  exports: [EntitlementsService, InboxLimitGuard],
})
export class EntitlementsModule {}
