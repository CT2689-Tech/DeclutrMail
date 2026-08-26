/**
 * Zod-free first-touch signup attribution primitives.
 *
 * Keep this module dependency-free: middleware and marketing CTAs run on
 * every public-page navigation and only need to parse the small `ref`
 * allowlist. The self-report request schema lives in signup-attribution.ts.
 */

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

const REF_SET = new Set<string>(SIGNUP_ATTRIBUTION_REFS);

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
