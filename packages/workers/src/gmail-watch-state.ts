import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { mailboxAccounts } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';

/** The Drizzle client, bound to the full `@declutrmail/db` schema. */
type WatchStateDb = PostgresJsDatabase<typeof schema>;

/**
 * Gmail watch-state persistence (D8/D225 — `users.watch` pipeline).
 *
 * WHERE THE STATE LIVES — and why it is a namespaced jsonb key.
 * `packages/db` is frozen for this wave (schema landed in PR #194), and
 * no dedicated column exists for the watch subscription. The only
 * per-mailbox jsonb state column is `mailbox_accounts.quiet_state`, so
 * the watch state is stored under the reserved top-level key
 * `gmail_watch` inside it:
 *
 *   quiet_state: { ..., "gmail_watch": { history_id, expiration, renewed_at } }
 *
 * Flagged in the PR body as a D-candidate (dedicated
 * `provider_sync_state` columns once the schema freeze lifts).
 *
 * CO-TENANCY CONTRACT. Quiet-mode state (D92/D93) shares this column.
 * Every write here is a `||` jsonb MERGE (or a `-` single-key delete) —
 * never a whole-column replace — so quiet keys survive watch writes.
 * The same contract applies in reverse: quiet-mode writers must merge,
 * not replace, or they will wipe `gmail_watch`. Correctness does not
 * depend on this state surviving, though — the 6h `WatchRenewalWorker`
 * re-watches every eligible mailbox unconditionally; this record exists
 * for observability (watch freshness / expiry dashboards + smoke
 * verification), not as a renewal trigger.
 *
 * Privacy (D7/D228): historyId + timestamps only — no message data.
 */
export interface GmailWatchState {
  /** Gmail historyId at watch time (decimal string). */
  history_id: string;
  /** Watch expiration as an ISO-8601 timestamp. */
  expiration: string;
  /** When WE last called `users.watch` successfully (ISO-8601). */
  renewed_at: string;
}

/** Reserved top-level key inside `mailbox_accounts.quiet_state`. */
export const GMAIL_WATCH_STATE_KEY = 'gmail_watch';

/**
 * Merge the watch state into `quiet_state` under the reserved key.
 * `||` merges at the top level, so sibling keys (quiet mode) survive.
 */
export async function persistGmailWatchState(
  db: WatchStateDb,
  mailboxAccountId: string,
  state: GmailWatchState,
): Promise<void> {
  await db
    .update(mailboxAccounts)
    .set({
      quietState: sql`${mailboxAccounts.quietState} || jsonb_build_object(${GMAIL_WATCH_STATE_KEY}::text, ${JSON.stringify(state)}::jsonb)`,
      updatedAt: sql`now()`,
    })
    .where(eq(mailboxAccounts.id, mailboxAccountId));
}

/**
 * Remove the watch state key (on `users.stop` — disconnect / deletion
 * purge). `-` deletes only the named top-level key; quiet keys survive.
 */
export async function clearGmailWatchState(
  db: WatchStateDb,
  mailboxAccountId: string,
): Promise<void> {
  await db
    .update(mailboxAccounts)
    .set({
      quietState: sql`${mailboxAccounts.quietState} - ${GMAIL_WATCH_STATE_KEY}::text`,
      updatedAt: sql`now()`,
    })
    .where(eq(mailboxAccounts.id, mailboxAccountId));
}

/**
 * Parse the watch state back out of a `quiet_state` value. Tolerant —
 * returns `null` for missing/foreign shapes (a half-written or
 * externally-mutated key must not crash a sweep).
 */
export function readGmailWatchState(quietState: unknown): GmailWatchState | null {
  if (typeof quietState !== 'object' || quietState === null) {
    return null;
  }
  const value = (quietState as Record<string, unknown>)[GMAIL_WATCH_STATE_KEY];
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.history_id !== 'string' ||
    typeof candidate.expiration !== 'string' ||
    typeof candidate.renewed_at !== 'string'
  ) {
    return null;
  }
  return {
    history_id: candidate.history_id,
    expiration: candidate.expiration,
    renewed_at: candidate.renewed_at,
  };
}
