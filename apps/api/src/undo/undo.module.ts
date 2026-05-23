import { Module } from '@nestjs/common';

import { UndoController } from './undo.controller.js';
import { UndoService } from './undo.service.js';

/**
 * UndoModule (D35, D58, D232) — owns `undo_journal`.
 *
 * Exposes `UndoService` so the destructive feature modules (archive,
 * unsubscribe, later, apply-rule) can `issue()` a token at mutation
 * time, and so `AccountDeletionOrchestrator` (D205) can read
 * `latestActiveExpiry()` for the D232 deletion-time computation.
 *
 * Unlike SyncModule, UndoModule has no queue producer of its own — the
 * cleanup worker runs in the worker process and produces nothing the
 * HTTP API needs to dispatch.
 *
 * Eager-loadable at boot: no env requirements beyond DATABASE_URL,
 * which is already provided by the global DbModule.
 */
@Module({
  controllers: [UndoController],
  providers: [UndoService],
  exports: [UndoService],
})
export class UndoModule {}
