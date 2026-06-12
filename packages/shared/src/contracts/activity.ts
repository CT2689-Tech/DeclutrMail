/**
 * Activity feed rule-attribution contract (U27 — D57).
 *
 * `GET /api/activity` rows carry an optional `rule` reference resolved
 * from `activity_log.rule_id → automation_rules` for
 * `source = 'autopilot'` rows. The FE renders "by Autopilot ·
 * <rule name>" and D58's undo confirm sheet uses the id to offer
 * "Also disable the rule that triggered this?".
 *
 * Null on the wire when:
 *   - the row is not Autopilot-attributed (triage / manual / screener), or
 *   - the originating rule was deleted (the FK is `onDelete: 'set null'`
 *     — the append-only audit row outlives the rule).
 *
 * Privacy (D7, D228): rule id + display name only — rule names are
 * user/preset metadata, never message content.
 */

import { z } from 'zod';

export const ActivityRuleRefSchema = z
  .object({
    /** `automation_rules.id` — resolvable for deep-link + D58 disable offer. */
    id: z.string().uuid(),
    /** `automation_rules.name` — display label ("Newsletter graveyard"). */
    name: z.string().min(1),
  })
  .strict();

export type ActivityRuleRef = z.infer<typeof ActivityRuleRefSchema>;
