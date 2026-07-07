// @declutrmail/shared/flags — THE feature-flag manifest (ADR-0025).
//
// The single place complicated features are registered so they can be
// enabled/disabled without hunting through feature code. Flipping a
// flag is a one-value change here; overriding WITHOUT a code change is
// an env var (`DM_FLAG_<SNAKE_CASE>`, see resolve.ts):
//
//   - apps/api / packages/workers: read process.env at runtime.
//   - apps/web: next.config.ts snapshots resolved flags into the build
//     (`NEXT_PUBLIC_DM_FLAGS`), so a Vercel env var + redeploy flips a
//     flag with no commit.
//
// Scope: OPERATIONAL kill-switches for complicated surfaces — not plan
// gating (that's entitlements/, D19) and never user preferences. A flag
// earns a row here when the feature is complex enough that the founder
// may want to switch it off in production without a revert.
//
// Registering: add the key + definition, then gate the feature's mount
// point with `isFeatureEnabled('<flag>')`. Keep the description precise
// about WHAT disappears when the flag is off.

import type { FlagDefinition } from './types';

export const FLAG_MANIFEST = {
  darkMode: {
    default: true,
    description:
      'Dark theme (D2 extension, founder-approved 2026-07-03). Off: the ' +
      'root layout skips theme-init.js so data-theme is never set (app ' +
      'renders light regardless of any stored preference) and the ' +
      'ThemeToggle is not rendered.',
  },
  senderPeek: {
    default: true,
    description:
      'Grid hover/focus peek overlay on sender cards (D49 usability ' +
      'pass). Off: cards render without the peek affordance; all verbs ' +
      'remain reachable through the card itself.',
  },
} as const satisfies Record<string, FlagDefinition>;

export type FeatureFlag = keyof typeof FLAG_MANIFEST;

export const FEATURE_FLAGS = Object.keys(FLAG_MANIFEST) as readonly FeatureFlag[];
