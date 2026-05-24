// D211 — Edge-state screen inventory at launch.
//
// "Premium products look cheap when only happy paths are designed."
// (D211, plan line 8042.) D211 enumerates the named edge states every
// launch screen must render. This file is the **typed** form of that
// inventory — not a Markdown doc — so it can be diffed, imported into
// tests, and surfaced to the design-system gate at PR time.
//
// What this file is:
//
//   1. A finite enum of named edge states (`EDGE_STATES`).
//   2. A `Record<ScreenId, EdgeStateCoverage>` declaring, per screen,
//      which states it MUST render before launch.
//   3. Per-state coverage flags: `required: true` (screen must ship
//      this state), `storybook: <story-file-pattern>` (where the
//      Storybook variant lives), `status: 'covered' | 'todo'`.
//
// What this file is NOT:
//
//   - A runtime checker. Coverage is verified at test-time by walking
//     the inventory and asserting matching `*.stories.tsx` files exist
//     (see `inventory.test.ts`).
//   - A copy registry. Microcopy lives in
//     `packages/shared/src/copy/*` and is governed by D209.
//
// How to extend:
//
//   - When a new screen ships, add a row to `EDGE_STATE_INVENTORY` and
//     mark each state `status: 'covered' | 'todo'`. `todo` is
//     intentional debt — the inventory test tolerates it but the
//     design-system gate (D210) flags it for follow-up.
//   - When a new edge state is identified (e.g. "billing payment
//     failed" from D211's table), add it to `EDGE_STATES` and update
//     every screen entry that should render it.
//
// Owning-D mapping (per the AUDIT PATCH on D211, plan line 8797):
// see comments inline beside each `EdgeState` value.

/** The closed set of edge states D211 enumerates. */
export const EDGE_STATES = [
  /** First paint waiting on server data. */
  'loading',
  /** Successful response with zero rows. */
  'empty',
  /** Full-screen failure — the whole surface is unusable. */
  'error',
  /** Partial failure — some rows loaded, some did not. */
  'partial-error',
  /** Browser is offline (D171 + D211). */
  'offline',
  /** User session expired or scope revoked (D4 + D155 + D211). */
  'unauthorized',
  /** Initial Gmail sync still in progress (D6 + D109 + D224). */
  'sync-in-progress',
  /** Initial Gmail sync failed transiently (D211-owned). */
  'sync-failed-transient',
  /** Gmail provider returned 429 (D5 + D211). */
  'quota-exceeded',
  /** Free-tier daily cap hit (D19 + D211). */
  'free-cap-reached',
  /** Sender row references a Gmail message that's been deleted (D211-owned). */
  'sender-deleted-upstream',
  /** Account-deletion grace period banner (D205 + D216 + D211). */
  'account-deletion-pending',
] as const;

export type EdgeState = (typeof EDGE_STATES)[number];

/** Stable identifier for a launch screen. */
export type ScreenId =
  | 'triage'
  | 'senders'
  | 'sender-detail'
  | 'app-error-boundary'
  | 'app-not-found'
  | 'app-global-error';

/**
 * Per-state coverage declaration.
 *
 * `required: true` means D211 mandates this state for this screen at
 * launch. `false` is allowed when a state is N/A (e.g. the 404 page
 * doesn't have a `loading` state).
 *
 * `storybook` is the filename (relative, glob-friendly) where the
 * variant lives. The inventory test resolves this to disk and fails
 * the build if the file is missing.
 *
 * `status`:
 *   - `covered`              — variant exists and is wired.
 *   - `covered-by-pr-52`     — variant ships in the parallel
 *                              `feat/d039-senders-tightening-pass-1`
 *                              branch (PR #52). Tracked as its own
 *                              literal so the inventory test fails
 *                              loudly if PR #52 merges first (this
 *                              status should become `covered` with a
 *                              real `storybook` pointer) OR is
 *                              cancelled (this status should drop back
 *                              to `todo`). Either way the dangling
 *                              linkage surfaces at PR time, not in
 *                              production.
 *   - `todo`                 — declared but not yet built; design-system
 *                              gate flags this without blocking merge.
 *   - `n/a`                  — explicitly not applicable.
 */
export interface StateCoverage {
  required: boolean;
  storybook?: string;
  status: 'covered' | 'covered-by-pr-52' | 'todo' | 'n/a';
}

export type EdgeStateCoverage = Record<EdgeState, StateCoverage>;

/**
 * The full inventory.
 *
 * Senders + Sender Detail required states are marked
 * `covered-by-pr-52` — a parallel branch
 * (`feat/d039-senders-tightening-pass-1`, PR #52) ships the storybook
 * variants. The explicit literal (rather than `todo`) makes the
 * cross-PR linkage diff-visible: when PR #52 merges, this file must
 * flip those entries to `covered` with a real `storybook` pointer.
 * If PR #52 is closed without shipping the variants, these entries
 * drop back to `todo`. Either way the design-system gate notices.
 */
export const EDGE_STATE_INVENTORY: Record<ScreenId, EdgeStateCoverage> = {
  triage: {
    loading: {
      required: true,
      storybook: 'apps/web/src/features/triage/triage-screen.stories.tsx',
      status: 'covered',
    },
    empty: {
      required: true,
      storybook: 'apps/web/src/features/triage/triage-screen.stories.tsx',
      status: 'covered',
    },
    error: {
      // Triage delegates full-screen errors to the App Router
      // boundary (`apps/web/src/app/error.tsx`) at this point.
      // A dedicated in-shell error state is a future enhancement.
      required: false,
      status: 'n/a',
    },
    'partial-error': {
      required: false,
      status: 'n/a',
    },
    offline: {
      required: false,
      status: 'todo',
    },
    unauthorized: {
      required: false,
      status: 'todo',
    },
    'sync-in-progress': {
      required: false,
      status: 'todo',
    },
    'sync-failed-transient': {
      required: false,
      status: 'todo',
    },
    'quota-exceeded': {
      required: false,
      status: 'todo',
    },
    'free-cap-reached': {
      // D33 EmptyFreeTier covers this — the upgrade nudge variant.
      required: true,
      storybook: 'apps/web/src/features/triage/triage-screen.stories.tsx',
      status: 'covered',
    },
    'sender-deleted-upstream': {
      required: false,
      status: 'n/a',
    },
    'account-deletion-pending': {
      required: false,
      status: 'todo',
    },
  },

  // Senders + Sender Detail — required edge-state variants ship in PR
  // #52 (`feat/d039-senders-tightening-pass-1`). Marked
  // `covered-by-pr-52` rather than `todo` so the cross-PR linkage is
  // explicit; the inventory test treats this literal as not-yet-covered
  // (no storybook resolution required) but the design-system gate can
  // surface it as a tracked dependency rather than free-floating debt.
  senders: {
    loading: { required: true, status: 'covered-by-pr-52' },
    empty: { required: true, status: 'covered-by-pr-52' },
    error: { required: true, status: 'covered-by-pr-52' },
    'partial-error': { required: false, status: 'n/a' },
    offline: { required: false, status: 'todo' },
    unauthorized: { required: false, status: 'todo' },
    'sync-in-progress': { required: false, status: 'todo' },
    'sync-failed-transient': { required: false, status: 'todo' },
    'quota-exceeded': { required: false, status: 'todo' },
    'free-cap-reached': { required: false, status: 'todo' },
    'sender-deleted-upstream': { required: false, status: 'n/a' },
    'account-deletion-pending': { required: false, status: 'todo' },
  },

  'sender-detail': {
    loading: { required: true, status: 'covered-by-pr-52' },
    empty: { required: true, status: 'covered-by-pr-52' },
    error: { required: true, status: 'covered-by-pr-52' },
    'partial-error': { required: false, status: 'todo' },
    offline: { required: false, status: 'todo' },
    unauthorized: { required: false, status: 'todo' },
    'sync-in-progress': { required: false, status: 'n/a' },
    'sync-failed-transient': { required: false, status: 'n/a' },
    'quota-exceeded': { required: false, status: 'n/a' },
    'free-cap-reached': { required: false, status: 'n/a' },
    'sender-deleted-upstream': { required: true, status: 'covered-by-pr-52' },
    'account-deletion-pending': { required: false, status: 'todo' },
  },

  // App Router error surfaces (D167).
  'app-error-boundary': {
    loading: { required: false, status: 'n/a' },
    empty: { required: false, status: 'n/a' },
    error: {
      required: true,
      storybook: 'apps/web/src/app/error.stories.tsx',
      status: 'covered',
    },
    'partial-error': { required: false, status: 'n/a' },
    offline: { required: false, status: 'n/a' },
    unauthorized: { required: false, status: 'n/a' },
    'sync-in-progress': { required: false, status: 'n/a' },
    'sync-failed-transient': { required: false, status: 'n/a' },
    'quota-exceeded': { required: false, status: 'n/a' },
    'free-cap-reached': { required: false, status: 'n/a' },
    'sender-deleted-upstream': { required: false, status: 'n/a' },
    'account-deletion-pending': { required: false, status: 'n/a' },
  },

  'app-not-found': {
    loading: { required: false, status: 'n/a' },
    empty: {
      // The 404 page itself IS the "no-such-route" empty state.
      required: true,
      storybook: 'apps/web/src/app/not-found.stories.tsx',
      status: 'covered',
    },
    error: { required: false, status: 'n/a' },
    'partial-error': { required: false, status: 'n/a' },
    offline: { required: false, status: 'n/a' },
    unauthorized: { required: false, status: 'n/a' },
    'sync-in-progress': { required: false, status: 'n/a' },
    'sync-failed-transient': { required: false, status: 'n/a' },
    'quota-exceeded': { required: false, status: 'n/a' },
    'free-cap-reached': { required: false, status: 'n/a' },
    'sender-deleted-upstream': { required: false, status: 'n/a' },
    'account-deletion-pending': { required: false, status: 'n/a' },
  },

  'app-global-error': {
    loading: { required: false, status: 'n/a' },
    empty: { required: false, status: 'n/a' },
    error: {
      // The outer boundary for layout-level crashes (D167).
      required: true,
      storybook: 'apps/web/src/app/global-error.stories.tsx',
      status: 'covered',
    },
    'partial-error': { required: false, status: 'n/a' },
    offline: { required: false, status: 'n/a' },
    unauthorized: { required: false, status: 'n/a' },
    'sync-in-progress': { required: false, status: 'n/a' },
    'sync-failed-transient': { required: false, status: 'n/a' },
    'quota-exceeded': { required: false, status: 'n/a' },
    'free-cap-reached': { required: false, status: 'n/a' },
    'sender-deleted-upstream': { required: false, status: 'n/a' },
    'account-deletion-pending': { required: false, status: 'n/a' },
  },
};

export type EdgeStateInventory = typeof EDGE_STATE_INVENTORY;
