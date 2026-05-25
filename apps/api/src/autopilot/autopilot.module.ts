import { Module } from '@nestjs/common';

import { AutopilotController } from './autopilot.controller.js';
import { AutopilotReadService } from './autopilot.read-service.js';

/**
 * AutopilotModule (D99-D105, D124, D196, D197, D234) — read + small
 * write surface for the Autopilot feature.
 *
 * Per ADR-0008 / D201 the module mirrors `SendersModule`: a thin
 * controller wired to a service that owns the SELECTs against
 * `automation_rules` and `rule_match_log`. The service also performs
 * the per-row Autopilot-internal mutations (toggle, mode change,
 * threshold, dismiss, pause-all) — none of those touch other
 * features' tables, so D204's cross-feature-via-events rule does not
 * apply (they're intra-feature writes).
 *
 * Out of scope (next PRs):
 *   - Approve flow — requires undo_journal write + outbox emission to
 *     the action consumer. Lands with the action-consumer worker.
 *   - Observe → Active 7-day auto-promotion cron — lands with the
 *     dedicated cron worker.
 *
 * Eager-loadable at boot — only needs DATABASE_URL (already global
 * via DbModule).
 */
@Module({
  controllers: [AutopilotController],
  providers: [AutopilotReadService],
  exports: [AutopilotReadService],
})
export class AutopilotModule {}
