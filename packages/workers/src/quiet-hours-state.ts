import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { mailboxAccounts } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';
import {
  isWithinQuietWindow,
  msUntilQuietWindowEnd,
  type QuietHoursConfig,
} from '@declutrmail/shared/contracts';

/** The Drizzle client, bound to the full `@declutrmail/db` schema. */
type QuietStateDb = PostgresJsDatabase<typeof schema>;

/**
 * Quiet-hours persistence + the quiet predicate (U18 — D92, D93, D95).
 *
 * WHERE THE STATE LIVES. `mailbox_accounts.quiet_state` jsonb, under
 * the namespaced top-level key `quiet_hours`:
 *
 *   quiet_state: { ..., "quiet_hours": { enabled, start_local,
 *                                        end_local, timezone, updated_at } }
 *
 * CO-TENANCY CONTRACT (mirrors `gmail-watch-state.ts`, the other
 * tenant of this column). The Gmail watch pipeline persists its watch
 * metadata under `quiet_state.gmail_watch`, and D92's manual quiet
 * toggle owns the un-namespaced top-level keys (`enabled`, `started_at`,
 * `until_at`, `source`). Every write here is therefore a jsonb `||`
 * MERGE scoped to the `quiet_hours` key — NEVER a whole-column
 * `.set({ quietState: ... })` replace. A replace would silently wipe
 * `gmail_watch` and kill push notifications (webhook-security audit of
 * PR #209, 2026-06-12). `quiet-hours-state.test.ts` pins the invariant.
 *
 * Privacy (D7/D228): times + a timezone name only — no message data.
 */

/** Reserved top-level key inside `mailbox_accounts.quiet_state`. */
export const QUIET_HOURS_STATE_KEY = 'quiet_hours';

/** Stored (snake_case) shape under the reserved key. */
interface StoredQuietHours {
  enabled: boolean;
  start_local: string;
  end_local: string;
  timezone: string;
  /** When the config was last written (ISO-8601) — observability only. */
  updated_at: string;
}

/**
 * Merge the quiet-hours config into `quiet_state` under the reserved
 * key. `||` merges at the top level, so sibling keys (`gmail_watch`,
 * the manual quiet toggle) survive.
 */
export async function persistQuietHoursState(
  db: QuietStateDb,
  mailboxAccountId: string,
  config: QuietHoursConfig,
  now: Date = new Date(),
): Promise<void> {
  const stored: StoredQuietHours = {
    enabled: config.enabled,
    start_local: config.startLocal,
    end_local: config.endLocal,
    timezone: config.timezone,
    updated_at: now.toISOString(),
  };
  await db
    .update(mailboxAccounts)
    .set({
      quietState: sql`${mailboxAccounts.quietState} || jsonb_build_object(${QUIET_HOURS_STATE_KEY}::text, ${JSON.stringify(stored)}::jsonb)`,
      updatedAt: sql`now()`,
    })
    .where(eq(mailboxAccounts.id, mailboxAccountId));
}

/**
 * Parse the quiet-hours config back out of a `quiet_state` value.
 * Tolerant — returns `null` for missing/foreign shapes (a manually
 * mutated key must not crash a sweep; an unconfigured mailbox has no
 * key at all). Validity of times/timezone is enforced at the PUT
 * boundary (`QuietHoursConfigSchema`), not re-checked here — the
 * window math fails CLOSED on an unevaluable timezone.
 */
export function readQuietHoursState(quietState: unknown): QuietHoursConfig | null {
  if (typeof quietState !== 'object' || quietState === null) {
    return null;
  }
  const value = (quietState as Record<string, unknown>)[QUIET_HOURS_STATE_KEY];
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.enabled !== 'boolean' ||
    typeof candidate.start_local !== 'string' ||
    typeof candidate.end_local !== 'string' ||
    typeof candidate.timezone !== 'string'
  ) {
    return null;
  }
  return {
    enabled: candidate.enabled,
    startLocal: candidate.start_local,
    endLocal: candidate.end_local,
    timezone: candidate.timezone,
  };
}

/**
 * Manual quiet-state predicate (D92 — the ad-hoc "Quiet until" toggle).
 *
 * `mailbox_accounts.quiet_state` top-level shape per D92:
 * `{ enabled, started_at, until_at, source }`. Quiet is ACTIVE when
 * `enabled === true` and `until_at` is absent, null, or in the future.
 * A present-but-unparseable `until_at` counts as ACTIVE — when the
 * stored state is ambiguous the safe side is to defer mutations, not
 * fire them.
 */
export function isQuietStateActive(quietState: unknown, now: Date): boolean {
  if (typeof quietState !== 'object' || quietState === null || Array.isArray(quietState)) {
    return false;
  }
  const state = quietState as Record<string, unknown>;
  if (state.enabled !== true) return false;
  const untilAt = state.until_at;
  if (untilAt === undefined || untilAt === null) return true;
  if (typeof untilAt !== 'string') return true;
  const parsed = Date.parse(untilAt);
  if (!Number.isFinite(parsed)) return true;
  return parsed > now.getTime();
}

/**
 * THE quiet predicate (U18 enforcement seam): quiet is active when the
 * manual toggle says so OR the recurring quiet-hours window covers
 * `now`. `AutopilotActionWorker` defers its whole sweep on this; the
 * API's `activeNow` field reports the same value so the UI and the
 * worker never disagree about "quiet right now".
 */
export function isQuietActive(quietState: unknown, now: Date): boolean {
  if (isQuietStateActive(quietState, now)) return true;
  const config = readQuietHoursState(quietState);
  return config !== null && isWithinQuietWindow(config, now);
}

/**
 * Milliseconds until quiet ends — the re-schedule hint for a deferred
 * sweep. Returns `null` when quiet is not active, is indefinite
 * (manual quiet with no `until_at`), or is unevaluable (no hint
 * computable — the next regular trigger sweeps instead).
 *
 * When BOTH the manual state and the window are active, the LATER end
 * wins: re-running earlier would just re-defer.
 */
export function msUntilQuietEnds(quietState: unknown, now: Date): number | null {
  const candidates: number[] = [];

  if (isQuietStateActive(quietState, now)) {
    const untilAt = (quietState as Record<string, unknown>).until_at;
    if (typeof untilAt !== 'string') return null; // indefinite manual quiet
    const parsed = Date.parse(untilAt);
    if (!Number.isFinite(parsed)) return null; // unevaluable — no hint
    candidates.push(parsed - now.getTime());
  }

  const config = readQuietHoursState(quietState);
  if (config !== null && isWithinQuietWindow(config, now)) {
    const ms = msUntilQuietWindowEnd(config, now);
    if (ms === null) return null; // unevaluable timezone — no hint
    candidates.push(ms);
  }

  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}
