import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  AUTOPILOT_PRESET_KEYS,
  type AutopilotPresetKey,
  automationRules,
  type schema,
} from '@declutrmail/db';

import { AUTOPILOT_PRESETS } from './autopilot-presets.js';

/** Drizzle client bound to the full schema. */
type Db = PostgresJsDatabase<typeof schema>;

/**
 * Seed the 5 D101 preset rules for one mailbox (D99, D101, D124).
 *
 * Idempotent — every call uses `ON CONFLICT DO NOTHING` against the
 * partial UNIQUE `(mailbox_account_id, preset_key)` index, so repeat
 * invocations after the first are no-ops. This is the intended trigger
 * pattern: the mailbox-created event fires the seeder; a backfill
 * script can run it across existing mailboxes; both produce the same
 * end state.
 *
 * Default state per D10 (Observe-first):
 *   - `enabled = false`  — user must enable each rule explicitly
 *   - `mode = 'observe'` — first matches log to `rule_match_log` only
 *
 * Default state per D101:
 *   - `confidence_threshold` set to the preset's `defaultThreshold`
 *     (#1, #2 only — null for the rest)
 *   - `action_payload` set to the preset's `defaultActionPayload`
 *     (#2 carries `{ and_archive_future: true }`)
 *   - `scope = 'account'`  — D102 per-inbox default
 *
 * Default state per D234:
 *   - `is_preset = true`     — V2 ships only presets; custom rules
 *     are accepted by the schema but rejected at the API layer
 *
 * Returns the count of NEW preset rows inserted (0 when called a
 * second time on a mailbox that already has its presets).
 *
 * Privacy (D7, D228): the row is rule metadata only — no sender data,
 * no mailbox content. The mailbox_account_id is the only mailbox-scoped
 * identifier in the inserted row.
 */
export async function seedAutopilotPresets(
  db: Db,
  mailboxAccountId: string,
): Promise<{ insertedKeys: AutopilotPresetKey[] }> {
  const rows = AUTOPILOT_PRESET_KEYS.map((key) => {
    const def = AUTOPILOT_PRESETS[key];
    return {
      mailboxAccountId,
      presetKey: key,
      isPreset: true,
      name: def.defaultName,
      enabled: false,
      mode: 'observe' as const,
      // numeric(3,2) — Drizzle accepts a string for numeric columns.
      // Null when the preset does not gate on engine confidence.
      confidenceThreshold: def.defaultThreshold !== null ? def.defaultThreshold.toFixed(2) : null,
      scope: 'account' as const,
      conditions: {},
      actionKind: def.actionKind,
      actionPayload: def.defaultActionPayload,
    };
  });

  // Partial UNIQUE on `(mailbox_account_id, preset_key) WHERE preset_key
  // IS NOT NULL`. ON CONFLICT must repeat the same predicate so Postgres
  // matches the partial index — without it the planner cannot prove the
  // ON CONFLICT specification corresponds to a unique constraint.
  const inserted = await db
    .insert(automationRules)
    .values(rows)
    .onConflictDoNothing({
      target: [automationRules.mailboxAccountId, automationRules.presetKey],
      where: sql`${automationRules.presetKey} IS NOT NULL`,
    })
    .returning({ presetKey: automationRules.presetKey });

  return {
    insertedKeys: inserted
      .map((r) => r.presetKey)
      .filter((k): k is AutopilotPresetKey => k !== null),
  };
}
