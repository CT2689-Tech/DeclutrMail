import { desc, eq, gt, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { activeSessions, users } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';
import { parseEmailPrefs, type EmailPrefs } from '@declutrmail/shared/contracts';
import { hasPostalAddress } from '@declutrmail/shared/copy';

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
 * `apps/api/src/notifications/templates/`); the worker owns
 * execution-time decisions that must reflect CURRENT state, not
 * enqueue-time state:
 *
 *   - recipient resolution (users.email by userId — never stored in
 *     Redis, so a deleted user simply skips),
 *   - the D165 per-category opt-out (`users.preferences.emailPrefs` —
 *     see `OPT_OUT_PREF_BY_KIND`),
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

/** The five template kinds this pipeline delivers (D162; D6; D232). */
export type EmailKind =
  'sync-complete' | 'sync-reminder-24h' | 'sync-failed' | 'deletion-scheduled' | 'deletion-receipt';

/**
 * Per-kind D165 opt-out key in `emailPrefs`. Kinds absent here are
 * SYSTEM emails (sync-failed, deletion-scheduled, deletion-receipt) —
 * required
 * account notices with no preference key (CAN-SPAM/GDPR carve-out).
 */
const OPT_OUT_PREF_BY_KIND: Partial<Record<EmailKind, keyof EmailPrefs>> = {
  'sync-reminder-24h': 'reminders',
  'sync-complete': 'syncComplete',
};

/**
 * Kinds whose PRIMARY PURPOSE is commercial advertising or promotion.
 * Only these require a physical postal address before they may send.
 *
 * ## Why this is not `OPT_OUT_PREF_BY_KIND`
 *
 * It used to be. The postal gate keyed off "does this kind have an
 * opt-out toggle", which reads *opt-out-able ⇒ commercial* — and those
 * are different questions. CAN-SPAM's test (16 CFR §316.3) is the
 * message's PRIMARY PURPOSE, not whether we were courteous enough to
 * offer a preference switch. A transactional notice may carry an
 * unsubscribe link without becoming an advertisement.
 *
 * Under the correct test, both opt-out-able kinds are transactional:
 * `sync-complete` ("Your inbox is ready" — N messages indexed, here is
 * the link) and `sync-reminder-24h` ("Your inbox is still ready")
 * report the result of a sync the recipient themselves started. Neither
 * carries a price, an upgrade pitch, or any promotional offer; both are
 * squarely §7702(17) relationship messages — information about the
 * recipient's own account and delivery of a service they requested.
 *
 * The old conflation blocked the first email every signup receives
 * (six dead-lettered sends observed in dev, 2026-07-28 onward) for a
 * rule that did not apply to it.
 *
 * ## Why the set is EMPTY rather than deleted
 *
 * Empty is a classification result, not an oversight: every kind
 * shipped today is a service notice. The gate stays so the first
 * genuinely promotional email — a feature announcement, a launch
 * blast, a win-back offer — is refused until an address exists, which
 * is the case the rule is actually about. Add the kind here and the
 * refusal below arms itself.
 *
 * The refusal path is therefore not currently reachable in production,
 * which would make it untested dead code. `email-send.worker.test.ts`
 * covers it by adding a kind to this set, so the wiring is pinned
 * independently of what is classified commercial today.
 */
export const COMMERCIAL_KINDS: ReadonlySet<EmailKind> = new Set<EmailKind>();

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
   * Pre-rendered HTML body. ABSENT for the plain-text-locked kinds —
   * D126 Part 3 ("Plain text only; no marketing chrome") and D189's
   * receipt. Optional rather than required so those kinds cannot be
   * forced to carry a body the plan forbids.
   */
  html?: string;
  /**
   * Extra provider headers — RFC 8058 List-Unsubscribe on opt-out-able
   * kinds. System notices (deletion) set none: there is nothing to
   * unsubscribe from.
   */
  headers?: Record<string, string>;
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
    html?: string;
    headers?: Record<string, string>;
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

    // CAN-SPAM §316.5 / CASL: commercial email MUST carry a physical
    // postal address. "Commercial" is decided by primary purpose — see
    // COMMERCIAL_KINDS, and note that it is deliberately NOT the
    // opt-out map. Until `BUSINESS_POSTAL_ADDRESS` is set, refuse
    // rather than send a non-compliant message — a PermanentError, not
    // a retry: no amount of retrying conjures an address, and the
    // failure must be loud in the worker metrics rather than a quiet
    // footer omission nobody notices until a complaint arrives.
    if (COMMERCIAL_KINDS.has(payload.kind) && !hasPostalAddress()) {
      throw new PermanentError(
        `Refusing to send commercial email kind "${payload.kind}": no physical postal ` +
          'address is configured (CAN-SPAM §316.5 / CASL). Set BUSINESS_POSTAL_ADDRESS in ' +
          'packages/shared/src/copy/postal-address.ts.',
      );
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

      const optOutKey = OPT_OUT_PREF_BY_KIND[payload.kind];
      if (optOutKey && !parseEmailPrefs(user.preferences)[optOutKey]) {
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
      // Conditional spreads: exactOptionalPropertyTypes forbids passing
      // an explicit `undefined` to an optional property.
      ...(payload.html === undefined ? {} : { html: payload.html }),
      ...(payload.headers === undefined ? {} : { headers: payload.headers }),
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
