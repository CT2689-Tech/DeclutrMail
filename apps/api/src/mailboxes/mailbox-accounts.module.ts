import { Module, forwardRef } from '@nestjs/common';

import { AuthCryptoModule } from '../auth/auth-crypto.module.js';
import { AuthModule } from '../auth/auth.module.js';
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
  imports: [AuthCryptoModule, UsersModule, forwardRef(() => AuthModule)],
  providers: [MailboxAccountsService, GmailWatchService, CurrentMailboxGuard],
  controllers: [MailboxesController],
  // Re-export `UsersModule` so importers (Senders/Triage/Undo/etc.)
  // that consume `CurrentMailboxGuard` get `UsersService` resolved in
  // their own DI context — the guard's constructor lists it as a
  // dependency. Without the re-export, NestJS throws at boot:
  //   "Nest can't resolve dependencies of the CurrentMailboxGuard
  //    (?, MailboxAccountsService). Please make sure that the argument
  //    UsersService at index [0] is available in the UndoModule context."
  // `GmailWatchService` is exported for `AuthSignupOrchestrator`
  // (watch-on-connect/reconnect) and the U22 deletion purge
  // (`stopAllForUser`).
  exports: [MailboxAccountsService, GmailWatchService, CurrentMailboxGuard, UsersModule],
})
export class MailboxAccountsModule {}
