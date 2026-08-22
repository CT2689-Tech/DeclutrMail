// @declutrmail/shared/contracts/error-codes — the single source of truth
// for DeclutrMail's domain error codes (ADR-0014).
//
// Companion to `error-envelope.ts` (D168): the envelope defines the
// *shape* of an error; this registry defines the *vocabulary* — every
// machine-readable `code` the API can return, plus its default HTTP
// status, D169 severity tier, retryability, and trust-first user-facing
// message (D209).
//
// Why a registry (not scattered string literals):
//   - One place to add/rename a code; a typo at a throw site or in FE
//     handling becomes a COMPILE error (the `ErrorCode` union), the same
//     anti-drift guarantee `envelope.ts` gives the success shape (D202).
//   - The BE `AllExceptionsFilter` resolves a thrown code's tier/retryable
//     from here instead of re-deriving them per throw site (D169).
//   - The FE (TanStack Query error handling, D170 critical-trust banners)
//     imports the SAME constants it branches on — no duplicated literals.
//
// What does NOT belong here: contextual/validation messages (e.g. Zod
// field errors surfaced by `BadRequestException`) stay where they're
// raised — they're per-request, not a fixed vocabulary.

import type { ErrorSeverityTier } from './error-envelope';

/** Metadata carried by every registered error code. */
export interface ErrorCodeSpec {
  /** Default HTTP status for responses carrying this code. */
  status: number;
  /** D169 tier — how the FE should react. */
  severityTier: ErrorSeverityTier;
  /** Whether retrying the identical request might succeed. */
  retryable: boolean;
  /** Default trust-first user-facing message (D209). Throw sites may override. */
  message: string;
}

/**
 * The registry. `as const satisfies …` keeps the literal key/value types
 * (so `ErrorCode` is the exact union) while still checking every entry
 * conforms to `ErrorCodeSpec`.
 *
 * Generic codes mirror the HTTP-status fallbacks the filter assigns when
 * a throw carries no domain code; domain codes are the named conditions
 * features raise.
 */
export const ERROR_CODES = {
  // --- generic / status-derived (filter fallback set) ---
  BAD_REQUEST: {
    status: 400,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: "Something about that didn't look right. Check the details and try again.",
  },
  UNAUTHORIZED: {
    status: 401,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'You need to sign in to continue.',
  },
  FORBIDDEN: {
    status: 403,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: "You don't have access to that.",
  },
  NOT_FOUND: {
    status: 404,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'That could not be found.',
  },
  CONFLICT: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: "That didn't apply — something changed since this page loaded. Refresh and try again.",
  },
  RATE_LIMITED: {
    status: 429,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: 'Too many requests. Try again shortly.',
  },
  INTERNAL_ERROR: {
    status: 500,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: 'Something went wrong on our side. Your mail is untouched — try again in a moment.',
  },

  // --- domain: mailbox scope (current-mailbox.guard, auth orchestrator) ---
  NO_ACTIVE_MAILBOX: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'No active Gmail account is connected. Connect one to continue.',
  },
  SELECT_MAILBOX: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Choose which Gmail account to work in.',
  },
  MAILBOX_NOT_OWNED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: "That Gmail account isn't connected to your DeclutrMail account.",
  },
  MAILBOX_OWNED_BY_OTHER_WORKSPACE: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message:
      'This Gmail account is already connected to a different DeclutrMail account. ' +
      "Sign in to that one to use it — moving a Gmail account between DeclutrMail accounts isn't supported yet.",
  },

  // --- domain: tier entitlements (D19, D77, D81) ---
  FREE_CAP_REACHED: {
    status: 402,
    severityTier: 'inline_recoverable',
    retryable: false,
    message:
      "You've used all your free cleanup actions for this month. Upgrade for unlimited cleanup — everything you've already done stays done.",
  },
  ACTION_TIER_REQUIRED: {
    status: 402,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'This action needs a higher plan. Upgrade to continue.',
  },
  INBOX_LIMIT_REACHED: {
    status: 402,
    severityTier: 'inline_recoverable',
    retryable: false,
    message:
      'Your plan has reached its limit on connected Gmail accounts. Upgrade to connect another.',
  },
  PRO_FEATURE_REQUIRED: {
    status: 402,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'This feature is part of the Pro plan. Upgrade to unlock it.',
  },

  // --- trust-affecting (D170) ---
  OAUTH_REVOKED: {
    status: 409,
    severityTier: 'critical_trust',
    retryable: false,
    message: 'Your Gmail connection was revoked. Reconnect your account to continue.',
  },

  // --- domain: billing (D117/D118 — apps/api/src/billing) ---
  BILLING_DISABLED: {
    status: 503,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Billing is not available yet.',
  },
  BILLING_NOT_PROVISIONED: {
    status: 503,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'This plan cannot be purchased yet. Please try again later.',
  },
  // A verified webhook we could not yet resolve to a workspace or a
  // catalog entry. NEVER 200: a 2xx tells the provider the event is
  // delivered and retries stop, which strands a real payment with no
  // subscription row. 503 keeps it in the provider's retry queue while
  // the founder fixes attribution or catalog drift.
  BILLING_WEBHOOK_UNRESOLVED: {
    status: 503,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: 'Billing event could not be resolved yet.',
  },
  BILLING_PROVIDER_ERROR: {
    status: 502,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: 'Our payment provider could not be reached. Please try again.',
  },
  /**
   * States the FACT and stops. It must not name a remedy.
   *
   * "Change your plan instead" was wrong in the same way the older "already
   * has an ACTIVE subscription" was: it asserts something this layer cannot
   * know. Changing plan has six refusal paths — Razorpay
   * (`PLAN_CHANGE_UNSUPPORTED`), a Founding Pro price lock
   * (`FOUNDING_PLAN_LOCKED`), an in-flight change (`PLAN_CHANGE_PENDING`), a
   * scheduled cancel (`SUBSCRIPTION_CANCELING`), a paused row
   * (`SUBSCRIPTION_PAUSED`), and too close to renewal
   * (`PLAN_CHANGE_TOO_LATE`). A generic error knows none of them.
   *
   * It also names no PLACE. These billing errors render inline in the plan
   * picker on Plan & billing, so "Open Plan & billing" pointed at the screen
   * already displaying the message. The controls that resolve it — the plan
   * cards, Cancel subscription, resume where the rail supports it — are on
   * that screen around the error. Stating the blocker is the whole job.
   */
  SUBSCRIPTION_EXISTS: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Your DeclutrMail account already has a subscription, so a new one cannot be started.',
  },
  /**
   * A PAUSED subscription blocking a new checkout — split from
   * `SUBSCRIPTION_EXISTS` (sandbox smoke 2026-07-29).
   *
   * It exists because the old message asserted the account "already has an
   * ACTIVE subscription", which is untrue of a paused row.
   *
   * Like SUBSCRIPTION_EXISTS it names no remedy. "Resume it, or cancel it and
   * subscribe again" was wrong twice over: resume does not exist on Razorpay
   * (`RESUME_UNSUPPORTED`), and cancelling only sets `cancel_at_period_end` —
   * the row stays `active` until the provider's period-end webhook, so a new
   * checkout is still blocked until then. "Subscribe again" implied something
   * immediate that can be weeks away.
   */
  SUBSCRIPTION_PAUSED_BLOCKS_NEW: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Your subscription is paused, so a new one cannot be started.',
  },
  /**
   * The THIRD branch of the same checkout guard (D253). A full refund ends
   * entitlement immediately (`entitlement_ends_at = now()`) while the row
   * stays `active` until the provider confirms the refund settled — so for
   * that window the customer holds nothing AND cannot buy.
   *
   * `SUBSCRIPTION_EXISTS` is simply false there: no live subscription
   * exists. Telling someone to manage a subscription that is already dead
   * is the assert-what-you-don't-know defect its own comment warns about,
   * one layer down.
   *
   * `retryable: true` — the only code in this cluster that is. It resolves
   * with no user action once the settlement pass flips the row, so the FE
   * must treat it as self-healing rather than permanent.
   *
   * Unlike its siblings this one DOES name a remedy, because here a real
   * one exists and this layer can know it: waiting. The reason the others
   * name none is that their exits are rail- and plan-dependent (resume,
   * change plan, cancel — each unavailable on some rail); "try again in a
   * few minutes" depends on nothing and points at the control the user is
   * already looking at. Naming no remedy would have been the dishonest
   * choice here, not the careful one.
   */
  SUBSCRIPTION_REFUND_SETTLING: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: true,
    message:
      'Your refund is being confirmed with your payment provider, so a new subscription can’t be started yet. This clears on its own — try again in a few minutes.',
  },
  CHECKOUT_IN_FLIGHT: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message:
      'A checkout for this account is already in progress — finish it there, or use "I didn\u2019t complete a payment" to release it.',
  },
  /**
   * No subscription this route can act on. The message names no verb:
   * three routes raise it (cancel, pause, resume) and "…to cancel" was
   * wrong on the other two — it read as a nonsense answer to "resume my
   * subscription" (sandbox smoke 2026-07-31).
   */
  NO_ACTIVE_SUBSCRIPTION: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'There is no active subscription on this account.',
  },
  /**
   * `resume-cancellation` with nothing scheduled to revoke. Distinct
   * from NO_ACTIVE_SUBSCRIPTION: the subscription exists and is
   * healthy, so the honest answer is "nothing to undo", not "nothing
   * is there". Idempotent double-click territory — the FE treats it as
   * success rather than an error worth showing.
   */
  NO_SCHEDULED_CANCELLATION: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'This subscription is not scheduled to cancel.',
  },
  /**
   * `resume-cancellation` on a row whose end was decided by a REFUND or
   * CHARGEBACK, not by the user. Revoking that schedule would clear the
   * provider's renewal block while `entitlement_ends_at` — the column
   * the tier recompute actually reads — keeps ending the plan: the
   * button would report a restored subscription the account does not
   * have. Support-led because un-doing a refund is a money decision, not
   * a schedule one.
   */
  CANCELLATION_NOT_REVOCABLE: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message:
      'This plan is ending because of a refund or chargeback, so it can’t be restored here. Email support@declutrmail.com and we’ll sort it out.',
  },
  /**
   * Razorpay has no pause primitive we are willing to drive (same
   * posture as RESUME_UNSUPPORTED — see D118). Fails closed to support
   * rather than half-pausing a subscription that keeps charging.
   */
  PAUSE_UNSUPPORTED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message:
      'Pausing is not available for subscriptions billed in India. Email support@declutrmail.com and we will pause it for you.',
  },
  FOUNDING_PRO_SOLD_OUT: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'All 250 Founding Pro spots have been claimed.',
  },
  SUBSCRIPTION_PAUSED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    // Pre-existing instance of the same defect as SUBSCRIPTION_EXISTS: it told
    // the user to "resume or cancel", and resume does not exist on Razorpay
    // (`RESUME_UNSUPPORTED`). States the blocker only — the rail-appropriate
    // options are the controls surrounding this message on Plan & billing.
    message: 'A paused subscription cannot change plans.',
  },
  FOUNDING_PLAN_LOCKED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message:
      'Changing plans would end your Founding Pro price lock. Email support@declutrmail.com if you want to switch anyway.',
  },
  PLAN_CHANGE_UNSUPPORTED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message:
      'Plan changes aren’t self-serve for this subscription yet — email support@declutrmail.com and we’ll switch you over.',
  },
  PLAN_CHANGE_PENDING: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Another plan change is still being confirmed. Please wait or contact support.',
  },
  PLAN_CHANGE_TOO_LATE: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message:
      'This plan change is too close to renewal to schedule safely. Try again after the renewal completes.',
  },
  SUBSCRIPTION_CANCELING: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'This subscription is already scheduled to cancel.',
  },
  RESUME_UNSUPPORTED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    // Support-led on purpose, matching what the billing screen already tells
    // a paused Razorpay subscriber. An earlier revision offered "cancel and
    // subscribe again" as the self-serve exit — but cancelling only schedules
    // the end of the period, so the replacement checkout stays blocked until
    // the provider's period-end webhook lands. Offering a remedy that does
    // not work yet is worse than naming the one that does.
    message:
      'No-charge resume is not available for this payment method. Email support@declutrmail.com and we will reactivate it safely.',
  },
  RESUME_PERIOD_ENDED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message:
      'The retained billing period has ended, so the subscription cannot resume without a new charge.',
  },

  // --- domain: account deletion (D205/D216/D232 — apps/api/src/account) ---
  DELETION_CONFIRM_MISMATCH: {
    status: 400,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'The confirmation phrase did not match. Type it exactly to continue.',
  },
  DELETION_ALREADY_PENDING: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Account deletion is already scheduled for this account.',
  },
  NO_PENDING_DELETION: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'There is no scheduled deletion to cancel.',
  },

  // --- domain: mailbox indexed-data deletion (D245) ---
  MAILBOX_DATA_DELETION_CONFIRM_MISMATCH: {
    status: 400,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'The confirmation phrase did not match this Gmail account.',
  },
  MAILBOX_DATA_DELETION_IN_PROGRESS: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: "This mailbox's saved data is still being deleted. Reconnect after it finishes.",
  },

  // --- domain codes recovered by the 2026-08-21 audit (ADR-0014) ---
  //
  // These 40 were thrown by the API with a `code` but were absent from
  // this registry, so `AllExceptionsFilter.resolve` fell through to
  // `codeForStatus` and flattened every one of them to BAD_REQUEST /
  // NOT_FOUND / CONFLICT / INTERNAL_ERROR on the wire. The FE branches
  // that tested for them — five of them for PROTECTED_SENDER alone —
  // could never match, so a Protected sender produced a generic
  // "couldn't archive" toast, no refetch, and a 409 that replayed
  // forever on every retry.
  //
  // ADR-0014 names exactly this bug as the reason the registry exists.
  // It regrew because nothing tested the JOIN: API specs assert `code`
  // on the THROWN exception, web tests mock the RESPONSE BODY, and the
  // filter deletes the code in between with both suites green. The
  // contract test alongside this registry is what stops it regrowing.
  // actions + recovery (D226, D232) — conflicts the user can resolve
  PROTECTED_SENDER: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'This sender is Protected. Confirm to apply the action anyway.',
  },
  NO_ACTIONABLE_SENDERS: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Every selected sender is Protected or no longer exists.',
  },
  ACTION_NOT_RECOVERABLE: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Only failed Archive, Later, or Delete actions can be reviewed here.',
  },
  ACTION_NO_LONGER_FAILED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'This action no longer needs recovery.',
  },
  ACTION_ALREADY_RECOVERED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'This action was already recovered successfully.',
  },
  RECOVERY_ALREADY_REQUESTED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'This recovery review was already confirmed.',
  },
  RECOVERY_ATTEMPT_STALE: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'A newer recovery attempt exists. Review the latest Activity state.',
  },
  RECOVERY_NOTHING_TO_APPLY: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'No Gmail messages require reconciliation.',
  },
  RECOVERY_PREVIEW_CONFLICT: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: 'A recovery review changed. Open the latest Activity row and try again.',
  },
  RECOVERY_PREVIEW_EXPIRED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: 'This recovery review expired. Refresh it before trying again.',
  },
  IDEMPOTENCY_KEY_CONFLICT: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'This recovery key was already used for a different confirmation.',
  },
  // Later (D82, D232)
  LATER_TIMER_NOT_FOUND: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'This sender no longer has an active Later timer.',
  },
  LATER_TIMER_SUPERSEDED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'This sender already has a newer Later schedule. The failed action was not replayed.',
  },
  LATER_RETURN_NOT_STUCK: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'This Later return does not need recovery.',
  },
  LATER_SENDER_REQUIRED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Later recovery requires the original sender scope.',
  },
  // unsubscribe lifecycle (D230)
  UNSUBSCRIBE_CHANNEL_UNKNOWN: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: "This sender hasn't been checked for an unsubscribe option yet.",
  },
  UNSUBSCRIBE_INTENT_REQUIRED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Record an unsubscribe intent before updating manual progress.',
  },
  UNSUBSCRIBE_INVALID_TRANSITION: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: "That unsubscribe step doesn't follow from the current progress.",
  },
  UNSUBSCRIBE_MANUAL_NOT_AVAILABLE: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Manual unsubscribe progress is available only for a mailto unsubscribe.',
  },
  UNSUBSCRIBE_CONCURRENT_TRANSITION: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: 'Unsubscribe progress changed concurrently. Refresh and try again.',
  },
  // sync readiness (D6, D224)
  SYNC_NOT_READY: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: 'Initial sync has not completed for this mailbox yet.',
  },
  // not found — scoped to the current mailbox
  SENDER_NOT_FOUND: {
    status: 404,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Sender not found in the current mailbox.',
  },
  ACTION_NOT_FOUND: {
    status: 404,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Action not found.',
  },
  RECOVERY_PREVIEW_NOT_FOUND: {
    status: 404,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Recovery preview not found.',
  },
  // request shape — caller must change something before retrying
  INVALID_REQUEST: {
    status: 400,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: "Something about that request didn't look right. Check the details and try again.",
  },
  INVALID_ID: {
    status: 400,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'That identifier is not valid.',
  },
  INVALID_REACH: {
    status: 400,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Only Delete may reach past the inbox.',
  },
  INVALID_TIMEZONE: {
    status: 400,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'That time zone is not one we recognise.',
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    status: 400,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'An Idempotency-Key header (at least 8 characters) is required for actions.',
  },
  LATER_WAKE_TIME_REQUIRED: {
    status: 400,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Choose a new future return time before recovering this Later action.',
  },
  LATER_WAKE_TIME_INVALID: {
    status: 400,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Wake time must be in the future.',
  },
  WAKE_TIME_NOT_APPLICABLE: {
    status: 400,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'A return time only applies to Later.',
  },
  // queue/transport degraded — the request is fine, the runway is not
  QUEUE_UNAVAILABLE: {
    status: 503,
    severityTier: 'inline_recoverable',
    retryable: true,
    message:
      'Actions are queued elsewhere right now. Your mail is untouched — try again in a moment.',
  },
  ACTION_QUEUE_UNAVAILABLE: {
    status: 503,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: 'Action recovery is temporarily unavailable. Your mail is untouched.',
  },
  RECOVERY_QUEUE_UNAVAILABLE: {
    status: 503,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: 'Recovery verification is temporarily unavailable. Your mail is untouched.',
  },
  ENQUEUE_FAILED: {
    status: 503,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: "That couldn't be queued just now. Your mail is untouched — try again in a moment.",
  },
  RECOVERY_ENQUEUE_FAILED: {
    status: 503,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: "Recovery couldn't be queued just now. Your mail is untouched — try again.",
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: 'That service is temporarily unavailable. Try again in a moment.',
  },
  // lifecycle limits
  GONE: {
    status: 410,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'The undo window for that action has expired.',
  },
  UNSUPPORTED_UNDO: {
    status: 501,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: "Undo isn't available for that action yet.",
  },
} as const satisfies Record<string, ErrorCodeSpec>;

/** The union of every registered error code. */
export type ErrorCode = keyof typeof ERROR_CODES;

/** Narrow an arbitrary value to a registered `ErrorCode`. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}
