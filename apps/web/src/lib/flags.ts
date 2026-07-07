/**
 * Web-side feature-flag accessor (ADR-0025).
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` into the client bundle
 * ONLY when the key is written literally — a dynamic
 * `process.env['NEXT_PUBLIC_' + k]` stays undefined in the browser. So
 * every flag's override is listed literally below; flipping a flag
 * without a commit = set the Vercel env var and redeploy.
 *
 * Adding a flag: add the manifest row in
 * `packages/shared/src/flags/manifest.ts`, then its literal env read
 * here — `flags.test.ts` in this directory fails until both exist.
 */

import { resolveAllFlags, type FeatureFlag } from '@declutrmail/shared';

export const WEB_FLAG_ENV: Record<string, string | undefined> = {
  DM_FLAG_DARK_MODE: process.env.NEXT_PUBLIC_DM_FLAG_DARK_MODE,
  DM_FLAG_SENDER_PEEK: process.env.NEXT_PUBLIC_DM_FLAG_SENDER_PEEK,
};

const FLAGS = resolveAllFlags(WEB_FLAG_ENV);

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FLAGS[flag];
}
