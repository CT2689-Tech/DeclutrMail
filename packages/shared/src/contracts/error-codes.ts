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
    message: 'The request was invalid.',
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
    message: 'That action conflicts with the current state.',
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
    message: 'Internal server error',
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
    message: 'Select a mailbox to continue.',
  },
  MAILBOX_NOT_OWNED: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'Selected mailbox is not connected to your workspace.',
  },
  MAILBOX_OWNED_BY_OTHER_WORKSPACE: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message:
      'This Google account is already connected to a different DeclutrMail workspace. ' +
      'Sign in with that account or disconnect it from the other workspace first.',
  },

  // --- domain: tier entitlements (D19, D77, D81) ---
  FREE_CAP_REACHED: {
    status: 402,
    severityTier: 'inline_recoverable',
    retryable: false,
    message:
      "You've used all 5 free cleanup actions. Upgrade to keep cleaning — everything you've already done stays done.",
  },
  INBOX_LIMIT_REACHED: {
    status: 402,
    severityTier: 'inline_recoverable',
    retryable: false,
    message:
      'Your plan has reached its connected-inbox limit. Upgrade to connect another Gmail account.',
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
  BILLING_PROVIDER_ERROR: {
    status: 502,
    severityTier: 'inline_recoverable',
    retryable: true,
    message: 'Our payment provider could not be reached. Please try again.',
  },
  SUBSCRIPTION_EXISTS: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'This workspace already has an active subscription.',
  },
  NO_ACTIVE_SUBSCRIPTION: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'There is no active subscription to cancel.',
  },
  FOUNDING_PRO_SOLD_OUT: {
    status: 409,
    severityTier: 'inline_recoverable',
    retryable: false,
    message: 'All 250 Founding Pro spots have been claimed.',
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
} as const satisfies Record<string, ErrorCodeSpec>;

/** The union of every registered error code. */
export type ErrorCode = keyof typeof ERROR_CODES;

/** Narrow an arbitrary value to a registered `ErrorCode`. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}
