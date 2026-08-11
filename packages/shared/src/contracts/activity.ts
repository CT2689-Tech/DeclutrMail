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

/**
 * `GET /api/activity` envelope meta (D55-D60).
 *
 * The FE previously took this meta on a bare cast, so a BE field rename
 * compiled clean and rendered the wrong number — the UI-truth bug class
 * (a surface asserting a fact it no longer knows). Parsing at the wire
 * boundary turns that into a loud failure instead.
 *
 * NOT `.strict()`, deliberately — same deploy-skew reasoning as
 * `OnboardingFirstTriageMetaSchema`. A BE that adds a meta field must
 * not hard-fail a web bundle that has not redeployed yet; unknown keys
 * are dropped, missing or mistyped KNOWN keys throw. Every field the FE
 * reads must therefore be declared here, or parsing would silently strip
 * it — which is the very failure this schema exists to prevent.
 *
 * Privacy (D7, D228): counts, filter echoes, and pagination cursors
 * only. No message content crosses this boundary.
 */
const ActivityStatsSchema = z.object({
  archived: z.number(),
  unsubscribed: z.number(),
  kept: z.number(),
  later: z.number(),
  /** D227 K/A/U/L/D — always present; `0` when no delete activity. */
  deleted: z.number(),
  followupsDismissed: z.number(),
  needsAttention: z.number(),
  /** Historic monthly volume, not a prevention claim. Null = unknown. */
  noisePreventedPerMonth: z.number().nullable(),
});

/** Canonical verbs plus the outcome/audit row variants (see D43, D56). */
const ActivityActionSchema = z.enum([
  'keep',
  'archive',
  'unsubscribe',
  'unsubscribe_confirmed',
  'unsubscribe_endpoint_accepted',
  'unsubscribe_failed',
  'unsubscribe_unconfirmed',
  'unsubscribe_action_required',
  'unsubscribe_draft_opened',
  'unsubscribe_user_marked_sent',
  'unsubscribe_unavailable',
  'later',
  'delete',
  'followup-dismiss',
  'marked_protected',
  'unmarked_protected',
]);

export const ActivityListMetaSchema = z.object({
  pagination: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number(),
  }),
  stats: ActivityStatsSchema,
  /** All-time stats across the whole mailbox history (ignores filters). */
  allTimeStats: ActivityStatsSchema,
  window: z.enum(['7d', '30d', '90d', 'all']),
  source: z.enum(['all', 'triage', 'manual', 'autopilot', 'screener']),
  /**
   * Filter echoes default to `[]` rather than being required, and that
   * asymmetry with `stats` is deliberate. For a COUNT, absent and zero
   * are different facts, so defaulting would rebuild the silent-zero
   * bug. For a filter echo there is no "unknown" state — the FE reads
   * empty as "no filter", which is exactly what an absent field means.
   * Defaulting also keeps a BE that ships a new echo ahead of the web
   * bundle from hard-failing the screen.
   */
  verbs: z.array(ActivityActionSchema).default([]),
  senderQuery: z.string(),
  dateFrom: z.string().nullable(),
  dateTo: z.string().nullable(),
  outcomes: z
    .array(z.enum(['completed', 'skipped', 'failed', 'recovered', 'protected']))
    .default([]),
});

export type ActivityListMeta = z.infer<typeof ActivityListMetaSchema>;
