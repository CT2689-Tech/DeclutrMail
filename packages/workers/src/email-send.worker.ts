import { desc, eq, gt, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { activeSessions, users } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';
import { parseEmailPrefs, type EmailPrefs } from '@declutrmail/shared/contracts';
import { hasPostalAddress } from '@declutrmail/shared/copy';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { TransientError, ValidationError } from './worker-errors.js';
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
 * Delivery classification. The dividing line is NOT severity but
 * whether the mail can have gone out, because that is what
 * `enqueueEmailSend`'s dedup consults — a thrown error dead-letters, and
 * a dead-lettered job is indistinguishable from one that delivered and
 * lost its confirmation, so it suppresses every later enqueue forever.
 * Only the genuinely ambiguous case may throw:
 *   - `transient` (Resend 5xx / network) → TransientError. Resend may
 *     have accepted the request before the confirmation was lost, so
 *     batchPolicy retries; exhausting attempts leaves it suppressed
 *     rather than risking a duplicate.
 *   - `disabled` (RESEND_API_KEY unset)  → SUCCESS with
 *     'skipped_delivery_disabled'. The port fail-closes before Resend, so
 *     nothing was sent — definitively. Loud (warn + metrics) but NOT
 *     dead-lettered, so setting the key lets the send be retried.
 *   - `permanent` (Resend 4xx)           → SUCCESS with
 *     'skipped_delivery_rejected'. Refused outright, so also
 *     definitively not sent; an unverified sending domain is exactly the
 *     kind of 4xx that gets fixed and must then be retryable.
 *   - `suppressed`                        → SUCCESS with outcome
 *     'skipped_suppressed' (a suppressed recipient is a designed skip).
 *
 * A malformed payload still throws ValidationError, deliberately: that is
 * a producer bug rather than an operational state, and a re-enqueue under
 * the same key would carry the same broken payload.
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
 * But the two opt-out-able kinds do NOT land on the same side of it, and
 * an earlier revision of this comment wrongly said they did.
 *
 * `sync-complete` ("Your inbox is ready" — N messages indexed, here is
 * the link) is transactional: it delivers the result of a service the
 * recipient asked for, which is §7702(17)(A)(v) almost verbatim. The old
 * conflation blocked it — the first email every signup receives, six
 * dead-lettered sends in dev from 2026-07-28 — for a rule that does not
 * apply to it.
 *
 * `sync-reminder-24h` is commercial, and stays gated. Its body opens by
 * restating YESTERDAY's completion, which `sync-complete` already
 * reported, so it carries no new transactional information; it exists
 * only because the recipient did not come back, and "five minutes of
 * triage is usually enough to feel the difference" is a value claim
 * about the product rather than a status report. Under the mixed-message
 * primary-purpose test that is promotional — and it is what every ESP
 * classifies as re-engagement/win-back. Sending it without a postal
 * address is the violation the rule is actually about.
 *
 * The distinction to hold on to: a reminder is not transactional merely
 * because the thing it reminds you of was. What makes a message
 * transactional is the information IT carries.
 */
export const COMMERCIAL_KINDS: ReadonlySet<EmailKind> = new Set<EmailKind>(['sync-reminder-24h']);

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
    | 'skipped_no_recipient'
    | 'skipped_no_postal_address'
    | 'skipped_delivery_disabled'
    | 'skipped_delivery_rejected';
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
      // A designed SKIP, not a failure — the send is refused either way,
      // but the distinction decides whether this mailbox can ever
      // receive the email again.
      //
      // It used to throw PermanentError for loudness. That made the job
      // terminal-`failed`, and a failed job cannot be told apart from
      // one that delivered and then lost its confirmation, so the dedup
      // in `enqueueEmailSend` must suppress it — permanently burying the
      // email for that mailbox (the reminder's jobId is per-MAILBOX with
      // nothing re-deriving it). Reaping failed jobs instead would risk
      // duplicating a genuinely-sent message. Both Codex stop-reviews,
      // 2026-07-29.
      //
      // Skipping escapes that bind: nothing was delivered and we KNOW
      // it, so the outcome is recorded, the enqueue dedup can safely
      // allow a later attempt, and setting BUSINESS_POSTAL_ADDRESS
      // genuinely restores delivery.
      //
      // Loudness is preserved without poisoning the queue: warn-level
      // with the reason, plus the outcome in `worker.succeeded` metrics.
      // A dead-letter row was never the only way to be loud, and it was
      // the one way that also broke delivery.
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'email.refused_no_postal_address',
          worker: this.workerName,
          emailKind: payload.kind,
          detail:
            'Commercial email cannot send without a physical postal address ' +
            '(CAN-SPAM §316.5 / CASL). Set BUSINESS_POSTAL_ADDRESS in ' +
            'packages/shared/src/copy/postal-address.ts.',
        }),
      );
      return { outcome: 'skipped_no_postal_address', kind: payload.kind, providerId: null };
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
      // `disabled` and `permanent` are DEFINITIVELY not-sent: the port
      // fail-closed without a key, or the provider refused outright.
      // Recording that is what lets `enqueueEmailSend` retry them later,
      // and the asymmetry makes the choice: a reapable known-unsent
      // failure costs at worst a futile re-attempt, while suppressing one
      // costs a real email, silently and permanently.
      //
      // They used to throw PermanentError, which is why they dead-lettered
      // — and a dead-lettered job is indistinguishable from one that
      // delivered and lost its confirmation, so the dedup had to suppress
      // it forever. That buried exactly the cases most likely to be FIXED
      // and retried: an unset RESEND_API_KEY, or an unverified sending
      // domain (Codex stop-review 2026-07-29, the fourth pass over this
      // dedup). `transient` below stays a throw because it is the only
      // genuinely ambiguous outcome — Resend may have accepted the request
      // before the confirmation was lost.
      //
      // Loudness is preserved without burial, and deliberately on BOTH
      // channels. Dropping the throw also dropped these out of the
      // dead-letter sweep, which is what forwards to Sentry — so the
      // observer is called directly. Losing delivery is bad; losing
      // delivery AND the signal that it stopped is how a mail outage sits
      // unnoticed, the same blind spot a dependency-free health check
      // already created here once.
      case 'disabled':
      case 'permanent': {
        const outcome =
          delivered.reason === 'disabled'
            ? 'skipped_delivery_disabled'
            : 'skipped_delivery_rejected';
        this.observer.captureBackgroundFailure(
          new Error(`email not delivered (${delivered.reason}): ${delivered.detail}`),
          { kind: 'email.not_delivered', tags: { emailKind: payload.kind, outcome } },
        );
        console.warn(
          JSON.stringify({
            level: 'warn',
            kind: 'email.not_delivered',
            worker: this.workerName,
            emailKind: payload.kind,
            outcome,
            detail: delivered.detail,
          }),
        );
        return { outcome, kind: payload.kind, providerId: null };
      }
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
