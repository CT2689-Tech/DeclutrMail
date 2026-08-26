/**
 * First-touch signup attribution (marketing runbook Phase B).
 *
 * Two signals, never summed:
 *   - Tracked `ref` — explicit query param, set-once, persisted through
 *     Google OAuth state so the post-callback referrer (`accounts.google.com`)
 *     cannot steal credit.
 *   - Self-report — "How did you first hear about us?", separate column.
 *
 * We do not infer a channel from the `Referer` header. Unknown / junk
 * values drop to undefined rather than being stored.
 */

import { z } from 'zod';

/** First-party cookie that holds the captured first-touch `ref`. */
export const SIGNUP_REF_COOKIE = 'dm_signup_ref';

/** Allowlisted first-touch channels. Query param `ref` only. */
export const SIGNUP_ATTRIBUTION_REFS = [
  'hn',
  'ph',
  'reddit',
  'simulator',
  'x',
  'linkedin',
] as const;

export type SignupAttributionRef = (typeof SIGNUP_ATTRIBUTION_REFS)[number];

/** Self-report values that do not carry free-text. */
const HEARD_FROM_WITHOUT_OTHER = [...SIGNUP_ATTRIBUTION_REFS, 'friend', 'skipped'] as const;

export const SIGNUP_HEARD_FROM_VALUES = [...HEARD_FROM_WITHOUT_OTHER, 'other'] as const;

export type SignupHeardFrom = (typeof SIGNUP_HEARD_FROM_VALUES)[number];

const REF_SET = new Set<string>(SIGNUP_ATTRIBUTION_REFS);

/** Cap on the Other free-text field. */
export const SIGNUP_HEARD_DETAIL_MAX = 200;

/**
 * Parse a query-param / cookie / OAuth-state candidate. Trims and
 * lowercases; anything outside the allowlist is dropped.
 */
export function parseSignupAttributionRef(value: unknown): SignupAttributionRef | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return REF_SET.has(normalized) ? (normalized as SignupAttributionRef) : undefined;
}

/**
 * Set-once first-touch: an already-captured allowlisted value wins, then
 * an explicit `?ref=`, then a bare simulator visit. Later `?ref=simulator`
 * cannot overwrite `?ref=hn`.
 */
export function resolveFirstTouchRef(input: {
  existing?: unknown;
  queryRef?: unknown;
  pathname: string;
}): SignupAttributionRef | undefined {
  const existing = parseSignupAttributionRef(input.existing);
  if (existing) return existing;
  const fromQuery = parseSignupAttributionRef(input.queryRef);
  if (fromQuery) return fromQuery;
  if (input.pathname === '/inbox-simulator' || input.pathname === '/demo') {
    return 'simulator';
  }
  return undefined;
}

/**
 * PATCH /api/me/signup-heard-from body. `other` requires a non-empty
 * detail; every other choice forbids it so junk text cannot ride along.
 */
export const SignupHeardFromPatchSchema = z.discriminatedUnion('heardFrom', [
  z
    .object({
      heardFrom: z.enum(HEARD_FROM_WITHOUT_OTHER),
    })
    .strict(),
  z
    .object({
      heardFrom: z.literal('other'),
      detail: z.string().trim().min(1).max(SIGNUP_HEARD_DETAIL_MAX),
    })
    .strict(),
]);

export type SignupHeardFromPatch = z.infer<typeof SignupHeardFromPatchSchema>;
