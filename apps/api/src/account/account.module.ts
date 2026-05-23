import { Module } from '@nestjs/common';

import { UndoModule } from '../undo/undo.module.js';
import { AccountDeletionOrchestrator } from './deletion.service.js';

/**
 * AccountModule (D205 + D232).
 *
 * Hosts `AccountDeletionOrchestrator` — the D205 orchestrator
 * responsible for the account-deletion lifecycle. This PR ships
 * schedule-computation only; persistence + the actual deletion job
 * land separately (see FOUNDER-FOLLOWUPS.md — "Account hard-delete
 * execution").
 *
 * Imports `UndoModule` to read `latestActiveExpiry` for the D232
 * formula. No controller — the orchestrator is consumed by the future
 * settings-account controller, not exposed as its own HTTP surface.
 */
@Module({
  imports: [UndoModule],
  providers: [AccountDeletionOrchestrator],
  exports: [AccountDeletionOrchestrator],
})
export class AccountModule {}
