import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { undoJournal } from '@declutrmail/db';
import type { NewUndoJournalEntry, UndoJournalEntry } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type { UndoActionKind, UndoPayload } from './undo.types.js';

/**
 * UndoService — owns `undo_journal` (D35, D58, D232).
 *
 * Per D204 services are read-only by default; the write methods here
 * are within the journal's OWN feature, which is the allowed pattern
 * (the alternative — emitting an event the journal feature consumes —
 * adds latency to a path the user actively waits on).
 *
 * The reverse-mutation work itself is NOT done here. Each destructive
 * feature module (archive, unsubscribe, later, apply-rule) will own its
 * own reverter and call back into this service to claim the
 * idempotency lock (`UPDATE … WHERE reverted_at IS NULL`) before
 * executing its Gmail mutation. This PR ships the journal contract +
 * lifecycle; the per-verb reverters land with each feature slice.
 */
@Injectable()
export class UndoService {
  /**
   * Default undo window per D232 — 7 days from issue time. Pro tier's
   * 30-day window (D81) is opted into by the caller passing an explicit
   * `expiresAt`; the column default (also 7d) keeps Free correct without
   * coordination.
   */
  private static readonly DEFAULT_WINDOW_DAYS = 7;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Issue a fresh undo token for a destructive action.
   *
   * Called by each destructive verb's handler at mutation-commit time.
   * The returned token MUST be surfaced in the response (per
   * architecture-guardian Check D and D58) so the client can render the
   * tray entry / "Undo" affordance.
   *
   * `expiresAt` is optional — omitted → 7-day default (Free tier, D232);
   * Pro tier passes `now + 30d` (D81). Validation that the caller's
   * tier supports the chosen window is the caller's responsibility (the
   * journal itself is tier-agnostic).
   */
  async issue(input: {
    mailboxAccountId: string;
    actionKind: UndoActionKind;
    payload: UndoPayload;
    expiresAt?: Date;
  }): Promise<UndoJournalEntry> {
    const row: NewUndoJournalEntry = {
      mailboxAccountId: input.mailboxAccountId,
      actionKind: input.actionKind,
      payload: input.payload,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };
    const [issued] = await this.db.insert(undoJournal).values(row).returning();
    if (!issued) {
      // The insert is unconditional; an empty returning is a driver-
      // level failure we cannot recover from at this layer.
      throw new Error('Failed to issue undo token.');
    }
    return issued;
  }

  /**
   * Mark a token as executed AND atomically claim the idempotency lock.
   *
   * Returns `'claimed'` on the first call (the caller now owns the
   * revert work), `'already-reverted'` on a replay (the caller returns
   * the recorded result without acting), `'expired'` when the window
   * has closed (HTTP 410 in the controller per D58), and `'not-found'`
   * when the token is unknown or belongs to a different mailbox.
   *
   * The single `UPDATE … RETURNING` is the lock: PostgreSQL's row-level
   * write lock serializes concurrent calls; whichever wins sets
   * `executed_at`, and subsequent calls see `executed_at IS NOT NULL`
   * and route to `recordRevertSuccess`'s replay path via this method's
   * `'already-reverted'` outcome (only set after revertedAt commits).
   *
   * Why two timestamps:
   *   - `executed_at`  is set on every accept of the request
   *   - `reverted_at`  is set only on successful revert
   * This separation lets a revert that FAILS mid-flight (Gmail
   * transient error) be safely retried by a fresh request: the new
   * request finds `reverted_at IS NULL` and re-runs.
   */
  async claimForRevert(
    token: string,
    mailboxAccountId: string,
  ): Promise<
    | { outcome: 'claimed'; entry: UndoJournalEntry }
    | { outcome: 'already-reverted'; entry: UndoJournalEntry }
    | { outcome: 'expired'; entry: UndoJournalEntry }
    | { outcome: 'not-found' }
  > {
    const [existing] = await this.db
      .select()
      .from(undoJournal)
      .where(and(eq(undoJournal.token, token), eq(undoJournal.mailboxAccountId, mailboxAccountId)))
      .limit(1);
    if (!existing) {
      return { outcome: 'not-found' };
    }
    if (existing.revertedAt !== null) {
      // Replay of an already-completed revert — return the recorded
      // success without re-running the Gmail mutation (idempotent).
      return { outcome: 'already-reverted', entry: existing };
    }
    if (existing.expiresAt.getTime() <= Date.now()) {
      // D58 "Undo expired" — the token outlived its window. Do NOT
      // execute even if reverted_at is still null; an expired action
      // would surprise the user (D233's "no silent damage" principle
      // extends here: out-of-window reverts are surprising too).
      return { outcome: 'expired', entry: existing };
    }
    // Atomic claim. `executed_at IS NULL` filters out a parallel claim
    // that already set the timestamp; that loser falls through to the
    // SELECT-on-replay path on its next attempt.
    const [claimed] = await this.db
      .update(undoJournal)
      .set({ executedAt: sql`now()` })
      .where(and(eq(undoJournal.token, token), isNull(undoJournal.executedAt)))
      .returning();
    if (!claimed) {
      // A racing request won the lock. Re-read so the caller's replay
      // path sees the committed `executed_at`. The committed row's
      // reverted_at may still be null (the winner hasn't finished
      // reverting yet) — in that case we surface as 'already-reverted'
      // because the winner OWNS the revert; the loser must not act.
      const [winner] = await this.db
        .select()
        .from(undoJournal)
        .where(eq(undoJournal.token, token))
        .limit(1);
      return { outcome: 'already-reverted', entry: winner ?? existing };
    }
    return { outcome: 'claimed', entry: claimed };
  }

  /**
   * Stamp `reverted_at` after the caller's revert succeeded.
   *
   * Separated from `claimForRevert` so a failed Gmail mutation leaves
   * `reverted_at` null — a subsequent request can re-run (Gmail-side
   * retries that DID succeed will be no-ops since the destructive
   * action was already applied; that's the point of carrying
   * `priorLabels` in the payload).
   */
  async recordRevertSuccess(token: string): Promise<UndoJournalEntry> {
    const [updated] = await this.db
      .update(undoJournal)
      .set({ revertedAt: sql`now()` })
      .where(eq(undoJournal.token, token))
      .returning();
    if (!updated) {
      throw new NotFoundException(`Undo token ${token} disappeared mid-revert.`);
    }
    return updated;
  }

  /**
   * List active (not-yet-reverted, not-yet-expired) tokens for one
   * mailbox, newest first (D35 persistent tray).
   *
   * The tray needs a small, fast list; cursor pagination is
   * unnecessary at the tray's UX scale (a few dozen entries in flight
   * at most). The `limit` cap protects the server from a misbehaving
   * client and matches the simple-bounded pattern from activity-log.
   */
  async listActive(mailboxAccountId: string, limit = 50): Promise<UndoJournalEntry[]> {
    return this.db
      .select()
      .from(undoJournal)
      .where(
        and(
          eq(undoJournal.mailboxAccountId, mailboxAccountId),
          isNull(undoJournal.revertedAt),
          gt(undoJournal.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(undoJournal.createdAt))
      .limit(limit);
  }

  /**
   * D232 deletion-time read.
   *
   * `AccountDeletionOrchestrator` computes the effective deletion time
   * as `max(now + 7d, latest_undo_expires_at)`. Reads the most distant
   * still-pending expiry across the mailbox; null when the mailbox has
   * no active tokens.
   */
  async latestActiveExpiry(mailboxAccountId: string): Promise<Date | null> {
    // Postgres returns the `MAX(timestamp)` aggregate without Drizzle's
    // column-level Date coercion (the type hint below is for the
    // caller's benefit; the driver hands back either a Date instance
    // or an ISO string depending on adapter — pglite differs from
    // postgres-js here). Normalize in one place.
    const [row] = await this.db
      .select({ maxExpiry: sql<Date | string | null>`MAX(${undoJournal.expiresAt})` })
      .from(undoJournal)
      .where(
        and(
          eq(undoJournal.mailboxAccountId, mailboxAccountId),
          isNull(undoJournal.revertedAt),
          gt(undoJournal.expiresAt, sql`now()`),
        ),
      );
    const raw = row?.maxExpiry ?? null;
    if (raw === null) {
      return null;
    }
    return raw instanceof Date ? raw : new Date(raw);
  }

  /**
   * Default expiry timestamp (D232 — 7 days).
   *
   * Surfaced as a static helper so callers that need to pass an
   * explicit `expiresAt` (Pro tier extending to 30d, tests anchoring on
   * a fixed clock) can derive theirs from the same base.
   */
  static defaultExpiresAt(now: Date = new Date()): Date {
    return new Date(now.getTime() + UndoService.DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  }
}
