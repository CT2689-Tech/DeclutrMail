import { desc, eq, gt, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { activeSessions, users } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';
import { parseEmailPrefs } from '@declutrmail/shared/contracts';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { PermanentError, TransientError, ValidationError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';

/**
 * EmailSendWorker (D162) — delivers one transactional email per job.
 *
 * Policy: `batchPolicy` (D225) — emails are fan-out batch items keyed
 * on the logical-event idempotency key; 3 attempts, 5s exponential
 * backoff, global concurrency.
 *
 * Layering: the job carries PRE-RENDERED `{subject, text}` (the
 * producer renders via the typed templates in
 * `apps/api/src/notifications/email-templates.ts`); the worker owns
 * execution-time decisions that must reflect CURRENT state, not
 * enqueue-time state:
 *
 *   - recipient resolution (users.email by userId — never stored in
 *     Redis, so a deleted user simply skips),
 *   - the D165 reminder opt-out (`users.preferences.emailPrefs`),
 *   - the "user returned" check for the 24h reminder (any session
 *     activity after `skipIfUserActiveSince` — see
 *     `hasUserActivitySince`),
 *   - delivery via the injected `EmailDeliveryPort` (the Resend-backed
 *     EmailService in apps/api, which fail-closes without an API key
 *     and consults the bounce/complaint suppression list).
 *
 * Error classification (verified by the no-key smoke):
 *   - `disabled` (RESEND_API_KEY unset)  → PermanentError — dead-letters
 *     on attempt 1; a missing key is config, not weather. NEVER retried
 *     forever, never silent (Sentry capture + structured log).
 *   - `permanent` (Resend 4xx)           → PermanentError.
 *   - `transient` (Resend 5xx / network) → TransientError — batchPolicy
 *     retries with backoff.
 *   - `suppressed`                        → SUCCESS with outcome
 *     'skipped_suppressed' (a suppressed recipient is a designed skip).
 *
 * Privacy (D7, D228): job payloads carry counts + dates + the user's
 * OWN mailbox address only — never message content, subjects, or
 * snippets. The result is metric-only.
 */

/** The four template kinds this pipeline delivers (D162; D6; D232). */
export type EmailKind =
  | 'sync-complete'
  | 'sync-reminder-24h'
  | 'deletion-scheduled'
  | 'deletion-receipt';

/** Kinds that honor the D165 `emailPrefs.reminders` opt-out. */
const OPT_OUT_KINDS: ReadonlySet<EmailKind> = new Set<EmailKind>(['sync-reminder-24h']);

/** One transactional email send. */
export interface EmailSendJobData {
  kind: EmailKind;
  /** Recipient — resolved to users.email at EXECUTION time. */
  userId: string;
  /** Pre-rendered subject (counts/dates only — no message content). */
  subject: string;
  /** Pre-rendered plain-text body (counts/dates only). */
  text: string;
  /**
   * Logical-event dedup key. Doubles as the BullMQ jobId AND the
   * provider Idempotency-Key — one send per logical event even across
   * worker retries.
   */
  idempotencyKey: string;
  /** Mailbox context, logs only. */
  mailboxAccountId?: string;
  /**
   * Reminder-only: skip the send when the user shows ANY session
   * activity after this ISO-8601 instant ("the user returned").
   */
  skipIfUserActiveSince?: string;
  /**
   * Explicit recipient override — ONLY for sends whose user row is
   * deliberately gone by execution time (the D232 deletion receipt:
   * the purge worker captures the address, enqueues, then drops the
   * account; execution-time `users.email` resolution would skip). The
   * suppression list still applies (checked in the delivery port).
   * Every other kind resolves via `userId` — never set this casually:
   * an address in Redis outlives the DB row by the job retention
   * window, which is exactly right for a deletion receipt and wrong
   * for everything else.
   */
  recipientOverride?: string;
}

/** Metric-only result (logged on `worker.succeeded`). */
export interface EmailSendResult {
  outcome:
    | 'sent'
    | 'skipped_user_returned'
    | 'skipped_opted_out'
    | 'skipped_suppressed'
    | 'skipped_no_recipient';
  kind: EmailKind;
  providerId: string | null;
}

/** Outcome of one delivery attempt through the port. */
export type EmailDeliveryOutcome =
  | { ok: true; providerId: string | null }
  | { ok: false; reason: 'disabled' | 'suppressed' | 'permanent' | 'transient'; detail: string };

/**
 * Delivery seam — implemented by `EmailService` (apps/api, Resend) and
 * by fakes in tests. Implementations MUST:
 *   - fail closed (`reason: 'disabled'`) when no provider key is
 *     configured — never pretend-send;
 *   - check the bounce/complaint suppression list before sending;
 *   - forward `idempotencyKey` to the provider.
 */
export interface EmailDeliveryPort {
  deliver(input: {
    to: string;
    subject: string;
    text: string;
    idempotencyKey: string;
  }): Promise<EmailDeliveryOutcome>;
}

export interface EmailSendWorkerDeps {
  db: PostgresJsDatabase<typeof schema>;
  delivery: EmailDeliveryPort;
}

export class EmailSendWorker extends BaseDeclutrWorker<EmailSendJobData, EmailSendResult> {
  readonly workerName = 'EmailSendWorker';
  readonly policy = 'batchPolicy' as const;

  constructor(private readonly deps: EmailSendWorkerDeps) {
    super();
  }

  protected override getIdempotencyKey(payload: EmailSendJobData): string {
    return payload.idempotencyKey;
  }

  async processJob(payload: EmailSendJobData, _ctx: WorkerContext): Promise<EmailSendResult> {
    if (
      !payload.userId ||
      !payload.kind ||
      !payload.subject ||
      !payload.text ||
      !payload.idempotencyKey
    ) {
      throw new ValidationError('email-send job payload is missing required fields.');
    }

    // Recipient resolution. `recipientOverride` short-circuits the
    // users lookup — ONLY the D232 deletion receipt sets it (the user
    // row is deliberately gone by send time; see the field's doc).
    // Override sends skip the opt-out + activity checks by design: a
    // deletion receipt is a required account notice (D216), and the
    // preference rows no longer exist to consult.
    let to = payload.recipientOverride ?? null;
    if (!to) {
      const [user] = await this.deps.db
        .select({ email: users.email, preferences: users.preferences })
        .from(users)
        .where(eq(users.id, payload.userId))
        .limit(1);

      if (!user) {
        // User deleted between enqueue and execution — nothing to send,
        // and nobody to send it to. Designed skip, not a failure.
        return { outcome: 'skipped_no_recipient', kind: payload.kind, providerId: null };
      }

      if (OPT_OUT_KINDS.has(payload.kind) && !parseEmailPrefs(user.preferences).reminders) {
        return { outcome: 'skipped_opted_out', kind: payload.kind, providerId: null };
      }

      if (payload.skipIfUserActiveSince) {
        const returned = await this.hasUserActivitySince(
          payload.userId,
          payload.skipIfUserActiveSince,
        );
        if (returned) {
          return { outcome: 'skipped_user_returned', kind: payload.kind, providerId: null };
        }
      }

      to = user.email;
    }

    const delivered = await this.deps.delivery.deliver({
      to,
      subject: payload.subject,
      text: payload.text,
      idempotencyKey: payload.idempotencyKey,
    });

    if (delivered.ok) {
      return { outcome: 'sent', kind: payload.kind, providerId: delivered.providerId };
    }
    switch (delivered.reason) {
      case 'suppressed':
        return { outcome: 'skipped_suppressed', kind: payload.kind, providerId: null };
      case 'disabled':
        // Missing RESEND_API_KEY is configuration, not weather —
        // dead-letter on attempt 1 instead of burning retries.
        throw new PermanentError(`email delivery disabled: ${delivered.detail}`);
      case 'permanent':
        throw new PermanentError(`email delivery rejected: ${delivered.detail}`);
      case 'transient':
        throw new TransientError(`email delivery failed transiently: ${delivered.detail}`);
    }
  }

  /**
   * "The user returned" (D6 reminder semantics) — true when ANY of the
   * user's sessions (revoked or not — a logout after coming back still
   * counts as having returned) shows `last_used_at` after `sinceIso`.
   *
   * `active_sessions.last_used_at` is bumped (best-effort) by
   * `SessionsService` on every authenticated API request, so this is
   * "did the user's browser talk to the app after the sync finished" —
   * which includes sitting on the sync-gate when it flipped ready.
   */
  private async hasUserActivitySince(userId: string, sinceIso: string): Promise<boolean> {
    const since = new Date(sinceIso);
    if (Number.isNaN(since.getTime())) {
      throw new ValidationError(`skipIfUserActiveSince is not a valid ISO instant: ${sinceIso}`);
    }
    const [row] = await this.deps.db
      .select({ id: activeSessions.id })
      .from(activeSessions)
      .where(and(eq(activeSessions.userId, userId), gt(activeSessions.lastUsedAt, since)))
      .orderBy(desc(activeSessions.lastUsedAt))
      .limit(1);
    return row !== undefined;
  }
}
