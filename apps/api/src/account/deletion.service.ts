import { Injectable } from '@nestjs/common';

import { UndoService } from '../undo/undo.service.js';

/**
 * Computed deletion schedule for a mailbox.
 *
 * `effectiveDeletionAt` is the timestamp the deletion job runs at;
 * `basis` records WHICH input dominated the `max(...)` so the Settings →
 * Account UI (D216 area) can explain "your deletion is delayed because
 * an undo expires on Mar 14" instead of showing a raw timestamp.
 */
export interface DeletionSchedule {
  /** Mailbox the schedule belongs to. */
  mailboxAccountId: string;
  /** Effective deletion time per D232 — `max(now + 7d, latest_undo_expires_at)`. */
  effectiveDeletionAt: Date;
  /** Which input dominated the max. */
  basis: 'flat-grace' | 'undo-window';
  /** The flat 7-day grace anchor (`now + 7d`) at computation time. */
  flatGraceAt: Date;
  /** The latest active undo expiry (null when no active tokens). */
  latestUndoExpiresAt: Date | null;
}

/**
 * AccountDeletionOrchestrator — D205 + D232 schedule computation.
 *
 * Scope of THIS PR (D232 — schedule-only):
 *
 *   - Compute the effective deletion timestamp.
 *   - Return it. Persistence + the actual deletion job land in a
 *     follow-up PR (see FOUNDER-FOLLOWUPS.md — "Account hard-delete
 *     execution").
 *
 *   This PR deliberately does NOT:
 *     - persist deletion intent (no `account_deletion_requests` table
 *       written here),
 *     - enqueue a cron job at `effective_deletion_at`,
 *     - pause sync (the D232 "Pause sync while pending" requirement
 *       needs the persisted intent),
 *     - perform any destructive operation.
 *
 *   The CLAUDE.md §9 stop-condition for account-deletion logic is
 *   honored: writing real deletion code would require founder review.
 *   Schedule computation is a pure read + arithmetic, no user data
 *   touched.
 *
 * Class name is `AccountDeletionOrchestrator` per D205's approved
 * orchestrator allowlist. The full orchestrator (sync pause +
 * scheduled job + waiver path) lands in the follow-up PR; this skeleton
 * is the schedule-computation seam those layers compose on top of.
 */
@Injectable()
export class AccountDeletionOrchestrator {
  /** D232 flat-grace window: 7 days. */
  private static readonly FLAT_GRACE_DAYS = 7;

  constructor(private readonly undo: UndoService) {}

  /**
   * Compute the effective deletion time per D232.
   *
   * Formula: `effective_deletion_time = max(now + 7d, MAX(expires_at))`
   * across all `undo_journal` rows for the mailbox where
   * `reverted_at IS NULL` AND `expires_at > now()`.
   *
   * Returns a `DeletionSchedule` so the caller can render the basis
   * label in Settings → Account.
   */
  async computeSchedule(
    mailboxAccountId: string,
    now: Date = new Date(),
  ): Promise<DeletionSchedule> {
    const flatGraceAt = new Date(
      now.getTime() + AccountDeletionOrchestrator.FLAT_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );
    const latestUndoExpiresAt = await this.undo.latestActiveExpiry(mailboxAccountId);

    // `max` is strictly >; an exact tie (within a microsecond) is
    // treated as flat-grace because the flat-grace anchor is the
    // user's contract baseline and the undo-window basis only takes
    // over when it strictly extends.
    const useUndoWindow =
      latestUndoExpiresAt !== null && latestUndoExpiresAt.getTime() > flatGraceAt.getTime();

    return {
      mailboxAccountId,
      effectiveDeletionAt: useUndoWindow ? latestUndoExpiresAt : flatGraceAt,
      basis: useUndoWindow ? 'undo-window' : 'flat-grace',
      flatGraceAt,
      latestUndoExpiresAt,
    };
  }
}
