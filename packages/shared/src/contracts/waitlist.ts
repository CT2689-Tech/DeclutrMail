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
 * vocabulary (mirrors the `workspace_tier` pg enum); `source` is a
 * short app-chosen attribution slug (`pricing`, `landing`, …) — never
 * visitor free text.
 */

import { z } from 'zod';

import { TIER_IDS } from '../entitlements/types';

export const WaitlistJoinRequestSchema = z
  .object({
    /** RFC-shaped address; 320 is the SMTP path ceiling. */
    email: z.email().max(320),
    /** D19 tier the signup expressed interest in; omit for generic forms. */
    tierInterest: z.enum(TIER_IDS).optional(),
    /** App-chosen attribution slug — short, non-empty, never user free text. */
    source: z.string().trim().min(1).max(120),
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
