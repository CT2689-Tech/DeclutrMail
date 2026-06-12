import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { Queue } from 'bullmq';

import { accountDeletionRequests } from '@declutrmail/db';
import type { AccountDeletionRequest as AccountDeletionRequestRow } from '@declutrmail/db';
import {
  DELETION_CONFIRM_PHRASE,
  DELETION_WAIVER_PHRASE,
  type AccountDeletionBasis,
  type AccountDeletionProjection,
  type AccountDeletionStatus,
} from '@declutrmail/shared/contracts';
import { enqueueEmailSend, type EmailSendJobData } from '@declutrmail/workers';

import { AppException } from '../common/app-exception.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { deletionScheduledEmail } from '../notifications/email-templates.js';
import { SecurityEventsService } from '../security-events/security-events.service.js';
import { UndoService } from '../undo/undo.service.js';

/** Injection token for the email-send queue producer (fail-open). */
export const DELETION_EMAIL_QUEUE_TOKEN = 'ACCOUNT_DELETION_EMAIL_QUEUE';

/**
 * AccountDeletionOrchestrator — D205 + D216 + D232.
 *
 * Owns the `account_deletion_requests` lifecycle on the API side:
 *
 *   - `requestDeletion` — validate the typed confirmation phrase
 *     (D216), compute `effective_at` per D232, persist the request,
 *     enqueue the "deletion scheduled" email, audit to
 *     `security_events`.
 *   - `getStatus` — pending request (if any) + a fresh D232 projection
 *     so Settings → Account can show the date BEFORE requesting.
 *   - `cancel` — flip a pending request to `cancelled` during the
 *     grace window.
 *
 * D232 semantics (per the F5 ledger lock):
 *
 *   - `DELETE`                → effective_at = max(now + 7d,
 *     latest_undo_expires_at) where the undo aggregate is per-USER
 *     across ALL mailboxes (`UndoService.activeExpirySummaryForUser`).
 *   - `DELETE AND WAIVE UNDO` → waiver path: effective_at = now()
 *     (basis 'waived-immediate'); the purge sweep picks it up on its
 *     next tick. The waiver waives BOTH open undo windows and the
 *     7-day grace floor — "true immediate".
 *
 * Sync pause (D232 "Pause sync while pending"): enforced at the sync
 * ELIGIBILITY level, not here — see `packages/workers/src/
 * deletion-pause.ts` (worker guards) and the Gmail webhook's mailbox
 * resolution. This service only writes the request row those guards
 * read.
 *
 * The actual purge is the worker's job (`packages/workers/src/
 * deletion.worker.ts`), NOT this service — the API never deletes user
 * data inline in a request cycle.
 */
@Injectable()
export class AccountDeletionOrchestrator {
  /** D232 flat-grace window: 7 days. */
  private static readonly FLAT_GRACE_DAYS = 7;

  private readonly logger = new Logger(AccountDeletionOrchestrator.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly undo: UndoService,
    private readonly securityEvents: SecurityEventsService,
    @Optional()
    @Inject(DELETION_EMAIL_QUEUE_TOKEN)
    private readonly emailQueue: Queue<EmailSendJobData> | null = null,
  ) {}

  /**
   * Compute the D232 projection for a user — per-USER undo aggregate.
   *
   * `max` is strictly >; an exact tie (within a microsecond) is
   * treated as flat-grace because the flat-grace anchor is the user's
   * contract baseline and the undo-window basis only takes over when
   * it strictly extends.
   */
  async computeProjection(
    userId: string,
    now: Date = new Date(),
  ): Promise<AccountDeletionProjection> {
    const flatGraceAt = new Date(
      now.getTime() + AccountDeletionOrchestrator.FLAT_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );
    const { latest, activeCount } = await this.undo.activeExpirySummaryForUser(userId);
    const useUndoWindow = latest !== null && latest.getTime() > flatGraceAt.getTime();
    return {
      flatGraceAt: flatGraceAt.toISOString(),
      latestUndoExpiresAt: latest ? latest.toISOString() : null,
      activeUndoCount: activeCount,
      projectedEffectiveAt: (useUndoWindow ? latest : flatGraceAt).toISOString(),
      projectedBasis: useUndoWindow ? 'undo-window' : 'flat-grace',
    };
  }

  /** GET /api/account/deletion — pending request + fresh projection. */
  async getStatus(userId: string): Promise<AccountDeletionStatus> {
    const [pending, projection] = await Promise.all([
      this.findInFlight(userId),
      this.computeProjection(userId),
    ]);
    return {
      request: pending ? toPendingDto(pending) : null,
      projection,
    };
  }

  /**
   * POST /api/account/deletion — schedule (or waive into immediate)
   * deletion for the authenticated user.
   *
   * The confirmation phrase is the gate (D216 + D232): anything other
   * than the two exact literals is a 400. The FE input is UX only —
   * the server re-validates verbatim.
   */
  async requestDeletion(
    principal: { userId: string },
    input: { confirmPhrase: string },
  ): Promise<AccountDeletionStatus> {
    const waived = input.confirmPhrase === DELETION_WAIVER_PHRASE;
    if (!waived && input.confirmPhrase !== DELETION_CONFIRM_PHRASE) {
      throw new AppException({ code: 'DELETION_CONFIRM_MISMATCH' });
    }

    const now = new Date();
    const projection = await this.computeProjection(principal.userId, now);
    const basis: AccountDeletionBasis = waived ? 'waived-immediate' : projection.projectedBasis;
    const effectiveAt = waived ? now : new Date(projection.projectedEffectiveAt);

    let inserted: AccountDeletionRequestRow | undefined;
    try {
      [inserted] = await this.db
        .insert(accountDeletionRequests)
        .values({
          userId: principal.userId,
          effectiveAt,
          basis,
          waiverConfirmed: waived,
          status: 'pending',
        })
        .returning();
    } catch (err) {
      // The partial unique index (one in-flight request per user)
      // rejects a duplicate with 23505 — map to the domain 409.
      if (isUniqueViolation(err)) {
        throw new AppException({ code: 'DELETION_ALREADY_PENDING' });
      }
      throw err;
    }
    if (!inserted) {
      throw new AppException({ code: 'DELETION_ALREADY_PENDING' });
    }

    await this.securityEvents.record({
      eventType: 'account.deletion_requested',
      severity: 'warning',
      userId: principal.userId,
      payload: {
        requestId: inserted.id,
        basis,
        waiverConfirmed: waived,
        effectiveAt: effectiveAt.toISOString(),
        activeUndoCount: projection.activeUndoCount,
      },
    });

    await this.enqueueScheduledEmail(principal.userId, inserted);

    return {
      request: toPendingDto(inserted),
      projection,
    };
  }

  /**
   * POST /api/account/deletion/cancel — cancel during the grace
   * window. Atomic conditional UPDATE: only a 'pending' request can be
   * cancelled (an 'executing' one is past the point of no return).
   */
  async cancel(userId: string): Promise<AccountDeletionStatus> {
    const [cancelled] = await this.db
      .update(accountDeletionRequests)
      .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(accountDeletionRequests.userId, userId),
          eq(accountDeletionRequests.status, 'pending'),
        ),
      )
      .returning({ id: accountDeletionRequests.id });
    if (!cancelled) {
      throw new AppException({ code: 'NO_PENDING_DELETION' });
    }

    await this.securityEvents.record({
      eventType: 'account.deletion_cancelled',
      severity: 'info',
      userId,
      payload: { requestId: cancelled.id },
    });

    return this.getStatus(userId);
  }

  /** The single in-flight ('pending' or 'executing') request, if any. */
  private async findInFlight(userId: string): Promise<AccountDeletionRequestRow | undefined> {
    const [row] = await this.db
      .select()
      .from(accountDeletionRequests)
      .where(
        and(
          eq(accountDeletionRequests.userId, userId),
          inArray(accountDeletionRequests.status, ['pending', 'executing']),
        ),
      )
      .limit(1);
    return row;
  }

  /**
   * Enqueue the "deletion scheduled" email (D216 step 2). Best-effort:
   * a Redis hiccup must not roll back an already-persisted request —
   * the user sees the scheduled state in-app either way. Idempotent on
   * the request id, so a re-request after cancel sends a fresh email.
   *
   * The cancel link is a deep link into the authed Settings → Account
   * surface (the grace banner / cancel button), NOT an unauthenticated
   * one-time-token endpoint — deliberately no new unauthenticated
   * mutation surface (PR body documents this).
   */
  private async enqueueScheduledEmail(
    userId: string,
    request: AccountDeletionRequestRow,
  ): Promise<void> {
    if (!this.emailQueue) {
      this.logger.warn(
        `account.deletion_email_skipped requestId=${request.id} (REDIS_URL unset — no queue)`,
      );
      return;
    }
    const appUrl = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const rendered = deletionScheduledEmail({
      scheduledFor: formatDateForEmail(request.effectiveAt),
      cancelUrl: `${appUrl}/settings?cancelDeletion=1`,
    });
    try {
      await enqueueEmailSend(this.emailQueue, {
        kind: 'deletion-scheduled',
        userId,
        subject: rendered.subject,
        text: rendered.text,
        idempotencyKey: `email__deletion-scheduled__${request.id}`,
      });
    } catch (err) {
      this.logger.error(
        `account.deletion_email_enqueue_failed requestId=${request.id} ` +
          `error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/** Map a DB row to the wire DTO (only in-flight rows reach this). */
function toPendingDto(row: AccountDeletionRequestRow): {
  id: string;
  requestedAt: string;
  effectiveAt: string;
  basis: AccountDeletionBasis;
  waiverConfirmed: boolean;
  status: 'pending' | 'executing';
} {
  return {
    id: row.id,
    requestedAt: row.requestedAt.toISOString(),
    effectiveAt: row.effectiveAt.toISOString(),
    basis: row.basis,
    waiverConfirmed: row.waiverConfirmed,
    status: row.status === 'executing' ? 'executing' : 'pending',
  };
}

/** Postgres unique-violation (23505) sniff — driver-agnostic. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === '23505') return true;
  const cause = (err as { cause?: unknown }).cause;
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === '23505'
  );
}

/** "June 18, 2026" — the email templates take a human-readable date. */
function formatDateForEmail(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
