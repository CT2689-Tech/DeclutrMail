import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';

/**
 * Autopilot rules — D99, D100, D101, D102, D104, D105, D124, D196, D197, D234.
 *
 * One row is one Autopilot rule (preset or custom) for one mailbox.
 *
 * V2 launch ships ONLY preset rules (`is_preset = true`); the custom rule
 * builder UI is flag-disabled per D197, but the schema accepts
 * `is_preset = false` rows so the V2.1 unlock is a pure API + UI change
 * (no migration). D234 lives at the API layer.
 *
 * Lifecycle (D10 + D101):
 *   1. New mailbox gets the 5 preset rows seeded with `enabled = false`,
 *      `mode = 'observe'`. The seed is an application-level concern —
 *      this migration creates only the empty table per the Atlas
 *      `data_depend = error` rule.
 *   2. User toggles `enabled = true`. Rule starts firing in Observe
 *      mode — `AutopilotApplyWorker` writes matches to `rule_match_log`
 *      with `mode_at_match = 'observe'`, no action emitted.
 *   3. After 7 days of Observe (or user click) → `mode = 'active'`,
 *      `mode_changed_at` reset. Subsequent matches emit action intents.
 *   4. User can flip `mode = 'paused'` (D105) or set `enabled = false`
 *      at any time. The apply worker filters on `enabled AND mode <> 'paused'`.
 *
 * D101 preset list (preset_key values):
 *   - `auto_archive_low_engagement`     (#1, threshold-bearing)
 *   - `auto_unsubscribe_noisy`          (#2, threshold-bearing)
 *   - `auto_screen_new_senders`         (#3)
 *   - `newsletter_graveyard`            (#4)
 *   - `long_dormant_unsubscribe`        (#5 — replaces VIP Brief per D124)
 *
 * "Auto-screen new senders" (#3) emits the `later` verdict per D227 —
 * "Screen" is an internal-only product noun for the Screener feature; the
 * stored value matches every other DeclutrMail enum that already uses
 * 'later' (sender_policy_type, triage_verdict, undo_action_kind).
 *
 * `conditions` and `action_payload` are jsonb. For presets, the matcher
 * logic lives in code (`packages/workers/src/autopilot-presets.ts` —
 * lands with the apply worker PR); the jsonb here mirrors the rule for
 * the read service / UI render. For custom rules (V2.1), the jsonb IS
 * the source of truth interpreted by the runtime matcher.
 *
 * `confidence_threshold` is non-null only for the two threshold-bearing
 * presets (#1, #2). It is a `numeric(3,2)` to match the engine's
 * `triage_decisions.confidence` precision so equality checks line up
 * without float drift.
 *
 * `scope` (D102) defaults to `'account'`. The `'all_accounts'` value is
 * the "Apply to all my inboxes" toggle; resolved at apply time by
 * fanning the rule across the user's mailboxes. `'workspace'` is
 * reserved for future multi-user workspaces.
 *
 * Privacy (D7, D228): the rule definition is metadata only. Conditions
 * reference engine signals (volume, read rate, last-seen, confidence,
 * Gmail category) — never message body content.
 *
 * Indexing:
 *   - `(mailbox_account_id, preset_key) UNIQUE WHERE preset_key IS NOT NULL` —
 *     one preset of a given kind per mailbox.
 *   - `(mailbox_account_id, enabled) WHERE enabled = true` partial —
 *     apply worker's hot load path scans only enabled rules.
 *
 * CHECK invariant: `is_preset = true` IFF `preset_key IS NOT NULL`.
 * Custom rules MUST set `is_preset = false` AND `preset_key = NULL`;
 * the API layer additionally rejects `is_preset = false` at V2 (D234).
 */

/** Lifecycle state for a rule. D10 + D101 + D105. */
export const autopilotRuleMode = pgEnum('autopilot_rule_mode', ['observe', 'active', 'paused']);

/** D102 — per-inbox / all-inboxes / workspace. */
export const autopilotRuleScope = pgEnum('autopilot_rule_scope', [
  'account',
  'all_accounts',
  'workspace',
]);

/**
 * What action the rule emits when it matches. The K/A/U/L set minus
 * 'keep' (Autopilot is non-firing on Keep — no rule produces a no-op).
 * D227: 'later' is the canonical store value for the "Screen" preset.
 */
export const autopilotActionKind = pgEnum('autopilot_action_kind', [
  'archive',
  'unsubscribe',
  'later',
]);

export const automationRules = pgTable(
  'automation_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    /**
     * System preset identifier (e.g. `'auto_archive_low_engagement'`).
     * NULL for custom rules. CHECK constraint pairs this with `isPreset`.
     */
    presetKey: text('preset_key'),
    /**
     * D196/D197 + D234. `true` for the 5 system presets; `false` for
     * future custom rules. The V2 launch API rejects `false` on writes;
     * the column is here so V2.1 unlock is API-only.
     */
    isPreset: boolean('is_preset').notNull().default(true),
    /** Display label. For presets, defaults to the preset's canonical title. */
    name: text('name').notNull(),
    /** D10 — Observe-first: rule does not fire until user enables. */
    enabled: boolean('enabled').notNull().default(false),
    /** D101 / D105 — observe → active → paused. */
    mode: autopilotRuleMode('mode').notNull().default('observe'),
    /** When `mode` last flipped — anchors the 7-day Observe → Active timer. */
    modeChangedAt: timestamp('mode_changed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /**
     * Confidence floor for threshold-bearing presets (#1, #2). NULL means
     * the rule does not gate on engine confidence. `numeric(3,2)` matches
     * `triage_decisions.confidence` so equality lines up.
     */
    confidenceThreshold: numeric('confidence_threshold', { precision: 3, scale: 2 }),
    /** D102 — per-inbox default, all-inboxes opt-in, workspace reserved. */
    scope: autopilotRuleScope('scope').notNull().default('account'),
    /**
     * D100 condition vocabulary, canonicalized. For presets the runtime
     * matcher reads code; this jsonb mirrors the rule for read/UI render.
     * For custom rules (V2.1) the runtime interprets this directly.
     */
    conditions: jsonb('conditions')
      .notNull()
      .default(sql`'{}'::jsonb`),
    actionKind: autopilotActionKind('action_kind').notNull(),
    /**
     * Action modifiers. E.g. preset #2 (auto-unsubscribe noisy) sets
     * `{ "and_archive_future": true }` to capture D101's "Unsubscribe +
     * auto-archive future".
     */
    actionPayload: jsonb('action_payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** D101 last-run summary — "Last run: 3:14 AM · 38 actions · 14 senders". */
    lastRunAt: timestamp('last_run_at', { withTimezone: true, mode: 'date' }),
    lastRunActions: integer('last_run_actions').notNull().default(0),
    lastRunSenders: integer('last_run_senders').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /** One preset of a given kind per mailbox. Custom rules (preset_key=NULL) bypass. */
    mailboxPresetUniq: uniqueIndex('automation_rules_mailbox_preset_uniq')
      .on(table.mailboxAccountId, table.presetKey)
      .where(sql`${table.presetKey} IS NOT NULL`),
    /** Apply worker hot path: load enabled rules for a mailbox. */
    mailboxEnabledIdx: index('automation_rules_mailbox_enabled_idx')
      .on(table.mailboxAccountId, table.enabled)
      .where(sql`${table.enabled} = true`),
    /**
     * Preset/custom invariant: `is_preset` and `preset_key IS NOT NULL`
     * agree. The API layer additionally rejects `is_preset = false` at
     * V2 (D234), but the schema enforces the structural invariant
     * regardless of API version.
     */
    presetKeyConsistent: check(
      'automation_rules_preset_key_consistent',
      sql`(${table.isPreset} = true AND ${table.presetKey} IS NOT NULL) OR (${table.isPreset} = false AND ${table.presetKey} IS NULL)`,
    ),
  }),
).enableRLS();

export type AutomationRule = typeof automationRules.$inferSelect;
export type NewAutomationRule = typeof automationRules.$inferInsert;
export type AutopilotRuleMode = (typeof autopilotRuleMode.enumValues)[number];
export type AutopilotRuleScope = (typeof autopilotRuleScope.enumValues)[number];
export type AutopilotActionKind = (typeof autopilotActionKind.enumValues)[number];

/**
 * Closed string union of the V2 preset identifiers (D101 + D124). The
 * apply worker maps each to its matcher in code; the read service uses
 * the union for typed `preset_key` lookups.
 */
export const AUTOPILOT_PRESET_KEYS = [
  'auto_archive_low_engagement',
  'auto_unsubscribe_noisy',
  'auto_screen_new_senders',
  'newsletter_graveyard',
  'long_dormant_unsubscribe',
] as const;
export type AutopilotPresetKey = (typeof AUTOPILOT_PRESET_KEYS)[number];
