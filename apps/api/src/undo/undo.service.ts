import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { actionJobs, mailboxAccounts, senders, undoJournal } from '@declutrmail/db';
import type { NewUndoJournalEntry, UndoJournalEntry } from '@declutrmail/db';
import { MIN_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type { UndoActionKind, UndoDecision, UndoPayload } from './undo.types.js';

/** Members listed per decision; totals stay exact beyond it. */
export const DECISION_MEMBERS_MAX = 25;

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
   * Fallback undo window for a caller that passes no explicit
   * `expiresAt` — the FLOOR across the ladder, derived.
   *
   * Was the literal 7, with a comment claiming "the column default
   * (also 7d) keeps Free correct without coordination". That stopped
   * being true when every tier moved to 30 days (2026-08-23). It was
   * latent rather than live — both production writers set `expires_at`
   * from `undoWindowDaysFor(tier)` and `issue()` has no production
   * callers — but `issue()` is exported and documented for the
   * per-verb reverters still to land, so the next slice that used it
   * would have promised 30 days and written a 7-day row.
   *
   * The floor, not a named tier: it can only ever under-promise, and a
   * caller who needs the reader's real window must pass it explicitly.
   */
  private static readonly DEFAULT_WINDOW_DAYS = MIN_UNDO_WINDOW_DAYS;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Issue a fresh undo token for a destructive action.
   *
   * Called by each destructive verb's handler at mutation-commit time.
   * The returned token MUST be surfaced in the response (per
   * architecture-guardian Check D and D58) so the client can render the
   * tray entry / "Undo" affordance.
   *
   * `expiresAt` is optional — omitted → `DEFAULT_WINDOW_DAYS` from now,
   * the floor across the ladder. Validation that the caller's tier
   * supports the chosen window is the caller's responsibility (the
   * journal itself is tier-agnostic).
   *
   * The fallback is computed HERE rather than left to the column
   * default. Omitting the column meant the real answer lived in
   * `0007_undo_journal.sql` — which still said 7 days after every tier
   * moved to 30, so `DEFAULT_WINDOW_DAYS` was a constant that described
   * behaviour it did not produce. Passing it explicitly makes the
   * manifest the single source and leaves the column default as
   * defense-in-depth rather than the mechanism.
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
      expiresAt: input.expiresAt ?? UndoService.defaultExpiresAt(),
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
   * Read-only revertability check for the ASYNC undo path (D226).
   *
   * The forward action runs in a worker, so the revert does too: the
   * controller validates here, then enqueues a reverse `action_jobs`
   * row. We do NOT set `executed_at` (the old sync `claimForRevert`
   * lock) — that timestamp filter stranded tokens whose async revert
   * failed (executed_at set, reverted_at null, no way to re-claim).
   * Idempotency now lives where it belongs: the reverse job's
   * `UPDATE undo_journal SET reverted_at=now() WHERE reverted_at IS NULL`
   * guard + the BullMQ `jobId=revert:<token>` dedup. Re-adding a label
   * is itself idempotent, so a duplicate runner is harmless.
   *
   * `'already-reverted'` → the controller returns the recorded success
   * without enqueueing. `'expired'` → HTTP 410 (D58). `'not-found'` →
   * HTTP 404 (unknown token or wrong mailbox).
   */
  async findRevertable(
    token: string,
    mailboxAccountId: string,
  ): Promise<
    | { outcome: 'ready'; entry: UndoJournalEntry }
    | { outcome: 'already-reverted'; entry: UndoJournalEntry }
    | { outcome: 'expired'; entry: UndoJournalEntry }
    | { outcome: 'not-found' }
  > {
    const [entry] = await this.db
      .select()
      .from(undoJournal)
      .where(and(eq(undoJournal.token, token), eq(undoJournal.mailboxAccountId, mailboxAccountId)))
      .limit(1);
    if (!entry) {
      return { outcome: 'not-found' };
    }
    if (entry.revertedAt !== null) {
      return { outcome: 'already-reverted', entry };
    }
    if (entry.expiresAt.getTime() <= Date.now()) {
      return { outcome: 'expired', entry };
    }
    return { outcome: 'ready', entry };
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
   * The tray's list, grouped into DECISIONS (D35's deferred "expanded
   * tray"; founder report 2026-09-20).
   *
   * `listActive` returns one row per undo TOKEN, and a bulk action over N
   * senders issues N tokens — so the tray printed N identical lines under
   * "N decisions applied" for ONE decision, each with an Undo that
   * (`POST /api/undo/:token`) silently reverses the whole batch. A
   * decision is the unit the user made, so that is the unit listed:
   * `coalesce(composite_id, id)` of the forward job, the same key
   * `getBatchStatus` and `enqueueCompositeRevert` already group by.
   *
   *   - `token`   any one active member token — enough to revert the
   *               whole decision. `groupId` is the STABLE identity: the
   *               token moves when the member it came from is undone.
   *   - totals    exact, from a grouped aggregate — never derived from
   *               the capped member list.
   *   - `members` largest first, capped at {@link DECISION_MEMBERS_MAX};
   *               each carries its own token for a one-sender undo
   *               (`POST /api/undo/:token/action`).
   *
   * A journal row with no forward job behind it (Autopilot writes those)
   * is its own nameless decision: `senderCount: 0`, `affectedCount: null`
   * — "unknown", never a fabricated 0 emails.
   *
   * Two queries, both keyed by the tray index. Column references that a
   * join makes ambiguous are spelled with `sql.raw`: the `sql` template
   * emits bare column names.
   */
  async listActiveDecisions(mailboxAccountId: string, limit = 50): Promise<UndoDecision[]> {
    const groupId = sql<string>`coalesce(${sql.raw('action_jobs.composite_id')}, ${sql.raw('action_jobs.id')}, ${sql.raw('undo_journal.token')})`;
    const jobJoin = and(
      eq(actionJobs.undoToken, undoJournal.token),
      eq(actionJobs.direction, 'forward'),
    );
    const active = and(
      eq(undoJournal.mailboxAccountId, mailboxAccountId),
      isNull(undoJournal.revertedAt),
      gt(undoJournal.expiresAt, sql`now()`),
    );

    const groups = await this.db
      .select({
        groupId,
        newestAt: sql<string>`max(${sql.raw('undo_journal.created_at')})`,
        expiresAt: sql<string>`min(${sql.raw('undo_journal.expires_at')})`,
        senderCount: sql<number>`count(distinct ${sql.raw("action_jobs.selector->>'senderId'")})::int`,
        jobCount: sql<number>`count(${sql.raw('action_jobs.id')})::int`,
        kindCount: sql<number>`count(distinct ${sql.raw('undo_journal.action_kind')})::int`,
        affectedCount: sql<number>`coalesce(sum(${sql.raw('action_jobs.affected_count')}), 0)::int`,
      })
      .from(undoJournal)
      .leftJoin(actionJobs, jobJoin)
      .where(active)
      .groupBy(groupId)
      .orderBy(desc(sql`max(${sql.raw('undo_journal.created_at')})`))
      .limit(limit);
    if (groups.length === 0) return [];

    const rows = await this.db
      .select({
        groupId,
        token: undoJournal.token,
        actionKind: undoJournal.actionKind,
        jobId: actionJobs.id,
        affectedCount: actionJobs.affectedCount,
        senderName: senders.displayName,
        senderEmail: senders.email,
      })
      .from(undoJournal)
      .leftJoin(actionJobs, jobJoin)
      .leftJoin(
        senders,
        and(
          eq(senders.mailboxAccountId, mailboxAccountId),
          sql`${sql.raw('senders.id')}::text = ${sql.raw("action_jobs.selector->>'senderId'")}`,
        ),
      )
      .where(
        and(
          active,
          inArray(
            groupId,
            groups.map((g) => g.groupId),
          ),
        ),
      );

    const byGroup = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byGroup.get(row.groupId);
      if (list) list.push(row);
      else byGroup.set(row.groupId, [row]);
    }

    return groups.map((g) => {
      const all = (byGroup.get(g.groupId) ?? []).sort(
        (a, b) => (b.affectedCount ?? 0) - (a.affectedCount ?? 0) || a.token.localeCompare(b.token),
      );
      // The decision's own verb: the anchor job when it is still active,
      // else the largest remaining member.
      const lead = all.find((r) => r.jobId === g.groupId) ?? all[0];
      return {
        groupId: g.groupId,
        token: (all.find((r) => r.jobId === g.groupId) ?? all[0])!.token,
        actionKind: lead!.actionKind,
        createdAt: new Date(g.newestAt),
        expiresAt: new Date(g.expiresAt),
        senderCount: g.senderCount,
        affectedCount: g.jobCount === 0 ? null : g.affectedCount,
        mixedKinds: g.kindCount > 1,
        members: all
          .filter((r) => r.jobId !== null)
          .slice(0, DECISION_MEMBERS_MAX)
          .map((r) => ({
            token: r.token,
            actionKind: r.actionKind,
            senderName: r.senderName || r.senderEmail || null,
            affectedCount: r.affectedCount ?? 0,
          })),
      };
    });
  }

  /**
   * D232 deletion-time read — per USER, across ALL mailboxes.
   *
   * `AccountDeletionOrchestrator` computes the effective deletion time
   * as `max(now + 7d, latest_undo_expires_at)` where the aggregate is
   * `MAX(expires_at) FROM undo_journal WHERE user_id = ?` (the D232
   * rule text is explicitly user-scoped). The previous implementation
   * aggregated per-MAILBOX, which under-counted for two-mailbox users —
   * an undo window on the OTHER mailbox could not extend the deletion
   * date (buildout 2026-06-11 per-USER fix). `undo_journal` keys on
   * `mailbox_account_id`, so the user scope is a join through
   * `mailbox_accounts.user_id`.
   *
   * Returns the most distant still-pending expiry plus the count of
   * active tokens (for the D232 UI copy: "You have N undoable actions,
   * the latest expiring in M days"). `latest` is null when no token is
   * active.
   */
  async activeExpirySummaryForUser(
    userId: string,
  ): Promise<{ latest: Date | null; activeCount: number }> {
    // Postgres returns the `MAX(timestamp)` aggregate without Drizzle's
    // column-level Date coercion (the type hint below is for the
    // caller's benefit; the driver hands back either a Date instance
    // or an ISO string depending on adapter — pglite differs from
    // postgres-js here). Normalize in one place. COUNT(*) likewise
    // arrives as a string on postgres-js (bigint) — Number() it.
    const [row] = await this.db
      .select({
        maxExpiry: sql<Date | string | null>`MAX(${undoJournal.expiresAt})`,
        activeCount: sql<number | string>`COUNT(*)`,
      })
      .from(undoJournal)
      .innerJoin(mailboxAccounts, eq(undoJournal.mailboxAccountId, mailboxAccounts.id))
      .where(
        and(
          eq(mailboxAccounts.userId, userId),
          isNull(undoJournal.revertedAt),
          gt(undoJournal.expiresAt, sql`now()`),
        ),
      );
    const raw = row?.maxExpiry ?? null;
    const activeCount = Number(row?.activeCount ?? 0);
    if (raw === null) {
      return { latest: null, activeCount };
    }
    return { latest: raw instanceof Date ? raw : new Date(raw), activeCount };
  }

  /**
   * Default expiry timestamp — `DEFAULT_WINDOW_DAYS` from now.
   *
   * Surfaced as a static helper so callers that need to pass an
   * explicit `expiresAt` (a tier-resolved window, tests anchoring on a
   * fixed clock) can derive theirs from the same base.
   */
  static defaultExpiresAt(now: Date = new Date()): Date {
    return new Date(now.getTime() + UndoService.DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  }
}
