import { Module, forwardRef } from '@nestjs/common';

import { AuthCryptoModule } from '../auth/auth-crypto.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EntitlementsModule } from '../common/entitlements/entitlements.module.js';
import { UsersModule } from '../users/users.module.js';
import { CurrentMailboxGuard } from './current-mailbox.guard.js';
import { GmailWatchService } from './gmail-watch.service.js';
import { MailboxAccountsService } from './mailbox-accounts.service.js';
import { MailboxesController } from './mailboxes.controller.js';

/**
 * MailboxAccountsModule (D205). Owns the `mailbox_accounts` entity.
 *
 *   - `MailboxAccountsService` — internal API consumed by AuthModule's
 *      `AuthSignupOrchestrator` for the connect flow, and by other
 *      modules that need to read mailbox state.
 *   - `MailboxesController` — public HTTP routes (list / disconnect /
 *      set-active) used by the FE account menu.
 *
 * Imports `AuthCryptoModule` for the `TokenCryptoService` (used at
 * disconnect to decrypt the refresh token before revoking it with
 * Google). Imports `UsersModule` to clear the active-mailbox
 * preference when its mailbox is disconnected.
 */
@Module({
  // `forwardRef(AuthModule)` breaks the circular dep:
  //   AuthModule imports MailboxAccountsModule (orchestrator needs the service)
  //   MailboxAccountsModule imports AuthModule (controllers use JwtGuard + CsrfGuard)
  // Both modules are eagerly loaded, so the forwardRef resolves once
  // Nest finishes wiring both.
  // `EntitlementsModule` backs `CapabilityGuard` on the quiet-hours PUT.
  imports: [AuthCryptoModule, UsersModule, forwardRef(() => AuthModule), EntitlementsModule],
  providers: [MailboxAccountsService, GmailWatchService, CurrentMailboxGuard],
  controllers: [MailboxesController],
  // Re-export `UsersModule` for mailbox controllers imported through
  // feature modules. `CurrentMailboxGuard` itself now resolves the
  // preference through MailboxAccountsService's single narrow query.
  // `GmailWatchService` is exported for `AuthSignupOrchestrator`
  // (watch-on-connect/reconnect) and the U22 deletion purge
  // (`stopAllForUser`).
  exports: [MailboxAccountsService, GmailWatchService, CurrentMailboxGuard, UsersModule],
})
export class MailboxAccountsModule {}
