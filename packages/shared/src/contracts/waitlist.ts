/**
 * Waitlist join contract — `POST /api/waitlist` (D19 pricing page,
 * Team waitlist row; reusable by other marketing forms).
 *
 * UNAUTHENTICATED endpoint, IP rate-limited (D156). The response is
 * intentionally identical for new and duplicate emails — always
 * `202 { status: 'accepted' }` — so the endpoint cannot be used as an
 * email-exists oracle. Dedupe happens server-side via the citext
 * unique index on `waitlist.email` (insert … on conflict do nothing).
 *
 * Privacy (D7, D228): the email is the visitor's explicit submission;
 * nothing else is captured. `tierInterest` reuses the D19 tier
 * vocabulary (mirrors the `workspace_tier` pg enum); `source` names the
 * form's surface and, optionally, the acquisition channel that produced
 * the visit (`pricing`, `pricing:reddit`).
 *
 * The channel half originates in the URL (`utm_source` / `ref`), so it
 * is visitor-INFLUENCED — which is why `SOURCE_PATTERN` below is a
 * strict allowlist rather than a length cap. The browser already
 * validates each half in `lib/attribution`; this schema is the boundary
 * that makes it true for any caller, since an unauthenticated endpoint
 * cannot assume its client is ours. Free text still never reaches the
 * column.
 */

import { z } from 'zod';

import { TIER_IDS } from '../entitlements/types';

/**
 * `surface` or `surface:channel`. Each half: lowercase, starts
 * alphanumeric, then alphanumerics plus `_`, `.`, `-`, max 64 — wide
 * enough for real referrers (`news.ycombinator.com`, `product-hunt`),
 * narrow enough to exclude whitespace, markup, and separators beyond
 * the single composing colon. Mirrors `SLUG_PATTERN` in
 * `apps/web/src/lib/attribution.ts`.
 */
export const SOURCE_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}(:[a-z0-9][a-z0-9_.-]{0,63})?$/;

export const WaitlistJoinRequestSchema = z
  .object({
    /** RFC-shaped address; 320 is the SMTP path ceiling. */
    email: z.email().max(320),
    /** D19 tier the signup expressed interest in; omit for generic forms. */
    tierInterest: z.enum(TIER_IDS).optional(),
    /** Attribution slug — `surface` or `surface:channel`, never free text. */
    source: z.string().trim().regex(SOURCE_PATTERN),
  })
  .strict();

export type WaitlistJoinRequest = z.infer<typeof WaitlistJoinRequestSchema>;

/**
 * The constant 202 body. One literal on purpose: a duplicate submit
 * returns the exact same payload as a fresh insert (no oracle).
 */
export interface WaitlistJoinResult {
  status: 'accepted';
}
