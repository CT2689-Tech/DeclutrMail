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

import { SIGNUP_ATTRIBUTION_REFS } from './signup-attribution-ref';

export {
  parseSignupAttributionRef,
  resolveFirstTouchRef,
  SIGNUP_ATTRIBUTION_REFS,
  SIGNUP_REF_COOKIE,
} from './signup-attribution-ref';
export type { SignupAttributionRef } from './signup-attribution-ref';

/** Self-report values that do not carry free-text. */
const HEARD_FROM_WITHOUT_OTHER = [...SIGNUP_ATTRIBUTION_REFS, 'friend', 'skipped'] as const;

export const SIGNUP_HEARD_FROM_VALUES = [...HEARD_FROM_WITHOUT_OTHER, 'other'] as const;

export type SignupHeardFrom = (typeof SIGNUP_HEARD_FROM_VALUES)[number];

/** Cap on the Other free-text field. */
export const SIGNUP_HEARD_DETAIL_MAX = 200;

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
