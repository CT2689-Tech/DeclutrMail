import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AUTOPILOT_ACTION_QUEUE, createRedisConnection } from '@declutrmail/workers';
import type { AutopilotActionJobData } from '@declutrmail/workers';

import { AuthModule } from '../auth/auth.module.js';
import { EntitlementsModule } from '../common/entitlements/entitlements.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { AutopilotController } from './autopilot.controller.js';
import { AUTOPILOT_ACTION_QUEUE_TOKEN, AutopilotReadService } from './autopilot.read-service.js';

/**
 * AutopilotModule (D99-D105, D124, D196, D197, D234) — read + small
 * write surface for the Autopilot feature.
 *
 * Per ADR-0008 / D201 the module mirrors `SendersModule`: a thin
 * controller wired to a service that owns the SELECTs against
 * `automation_rules` and `rule_match_log`. The service also performs
 * the per-row Autopilot-internal mutations (toggle, mode change,
 * threshold, dismiss, pause-all, approve) — none of those touch other
 * features' tables, so D204's cross-feature-via-events rule does not
 * apply (they're intra-feature writes).
 *
 * U14: the approve endpoints additionally PRODUCE `autopilot-action`
 * jobs; the CONSUMER (`AutopilotActionWorker`) runs in the worker
 * process and is the only writer of the Gmail mutation + undo_journal
 * + activity effects (D226). Queue construction is fail-open (matches
 * ActionsModule): when `REDIS_URL` is absent the factory returns
 * `null` and the approve endpoints surface a clear 503; reads stay up.
 *
 * Still out of scope (next PRs):
 *   - Day-7 Observe-window banner UI (U15) — the API already projects
 *     `observeWindowElapsed`; no auto-promotion exists by design.
 *
 * Eager-loadable at boot — needs only DATABASE_URL (global DbModule);
 * REDIS_URL is optional per the fail-open contract.
 */
@Module({
  imports: [AuthModule, MailboxAccountsModule, EntitlementsModule],
  controllers: [AutopilotController],
  providers: [
    {
      provide: AUTOPILOT_ACTION_QUEUE_TOKEN,
      useFactory: (): Queue<AutopilotActionJobData> | null => {
        const url = process.env.REDIS_URL;
        if (!url) {
          return null;
        }
        return new Queue<AutopilotActionJobData>(AUTOPILOT_ACTION_QUEUE, {
          connection: createRedisConnection(url),
        });
      },
    },
    AutopilotReadService,
  ],
  exports: [AutopilotReadService],
})
export class AutopilotModule {}
