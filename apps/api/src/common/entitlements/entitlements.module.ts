import { Module } from '@nestjs/common';

import { CapabilityGuard } from './capability.guard.js';
import { EntitlementsService } from './entitlements.service.js';
import { InboxLimitGuard } from './inbox-limit.guard.js';

/**
 * EntitlementsModule (D19, D77, D81) — server-side tier enforcement.
 *
 * Exposes `EntitlementsService` (free-cleanup-cap + inbox-limit gates +
 * the `/api/auth/me` quota summary), `InboxLimitGuard` (the
 * connect-mailbox OAuth start gate), and `CapabilityGuard` (the
 * `@RequiresCapability` Pro-feature 402). DB access rides the global
 * `DRIZZLE` provider.
 */
@Module({
  providers: [EntitlementsService, InboxLimitGuard, CapabilityGuard],
  exports: [EntitlementsService, InboxLimitGuard, CapabilityGuard],
})
export class EntitlementsModule {}
