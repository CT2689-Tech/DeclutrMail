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
//      Storybook variant lives), `status` (see `StateCoverage`).
//   4. A `Record<ScreenId, string | null>` (`SCREEN_ROUTES`) tying
//      each screen to its `apps/web/src/app/(app)` route dir, so the
//      inventory test can fail when a route ships without a row here.
//
// What this file is NOT:
//
//   - A runtime checker. Coverage is verified at test-time by walking
//     the inventory and asserting matching `*.stories.tsx` /
//     implementation files exist, and that route dirs and inventory
//     rows stay in lockstep (see `inventory.test.ts`).
//   - A copy registry. Microcopy lives in
//     `packages/shared/src/copy/*` and is governed by D209.
//
// How to extend:
//
//   - When a new screen ships, add a `ScreenId`, a row to
//     `EDGE_STATE_INVENTORY`, and a `SCREEN_ROUTES` entry — the
//     route-parity test fails until you do. Mark each state honestly:
//     `covered` (Storybook variant exists), `implemented` (state
//     branch ships in app code but has no dedicated Storybook
//     variant), `todo` (intentional debt — the inventory test
//     tolerates it but the design-system gate (D210) flags it for
//     follow-up), or `n/a`.
//   - When a new edge state is identified (e.g. "billing payment
//     failed" from D211's table), append it to `EDGE_STATES` and
//     update every screen entry that should render it.
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
  /**
   * The whole route is an intentional `RoutePlaceholder` stub — the
   * nav lists the surface but the feature is queued for a later
   * version. Recording this AS a state keeps the inventory honest:
   * placeholder routes have no loading/empty/error of their own
   * (static server render), and the placeholder itself is the one
   * designed state they ship (D211 refresh, 2026-06-11).
   */
  'placeholder',
] as const;

export type EdgeState = (typeof EDGE_STATES)[number];

/** Stable identifier for a launch screen. */
export type ScreenId =
  // Feature screens (data-driven).
  | 'triage'
  | 'senders'
  | 'sender-detail'
  | 'activity'
  | 'autopilot'
  | 'brief'
  | 'followups'
  | 'snoozed'
  | 'settings-senders'
  | 'settings-index'
  | 'settings-privacy'
  | 'admin-security'
  | 'quiet'
  // Placeholder routes — `RoutePlaceholder` stubs so the nav doesn't lie.
  | 'billing'
  | 'screener'
  // App Router error surfaces (D167) — not (app) routes.
  | 'app-error-boundary'
  | 'app-not-found'
  | 'app-global-error';

/**
 * Screen → route dir under `apps/web/src/app/(app)`, or `null` for
 * surfaces that are not (app) routes (the App Router error
 * boundaries live at `apps/web/src/app/*`). The inventory test
 * enumerates `page.tsx` route dirs on disk and asserts exact parity
 * with the non-null values here — adding a route without an
 * inventory row (or keeping a row for a deleted route) fails CI.
 */
export const SCREEN_ROUTES: Record<ScreenId, string | null> = {
  triage: 'triage',
  senders: 'senders',
  'sender-detail': 'senders/[id]',
  activity: 'activity',
  autopilot: 'autopilot',
  brief: 'brief',
  followups: 'followups',
  'settings-senders': 'settings/senders',
  'settings-index': 'settings',
  'settings-privacy': 'settings/privacy',
  'admin-security': 'admin/security',
  billing: 'billing',
  quiet: 'quiet',
  screener: 'screener',
  snoozed: 'snoozed',
  'app-error-boundary': null,
  'app-not-found': null,
  'app-global-error': null,
};

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
 * `implementation` is the app-code file where the state branch ships
 * when no dedicated Storybook variant exists (`status:
 * 'implemented'`). Same disk-existence rule as `storybook`.
 *
 * `status`:
 *   - `covered`     — Storybook variant exists and is wired.
 *   - `implemented` — state branch ships in app code (exercised by
 *                     the screen's unit tests) but has no dedicated
 *                     Storybook variant. Real coverage with Storybook
 *                     debt — the design-system gate (D210) flags the
 *                     missing story without blocking merge.
 *   - `todo`        — declared but not yet built; design-system gate
 *                     flags this without blocking merge.
 *   - `n/a`         — explicitly not applicable.
 */
export interface StateCoverage {
  required: boolean;
  storybook?: string;
  implementation?: string;
  status: 'covered' | 'implemented' | 'todo' | 'n/a';
}

export type EdgeStateCoverage = Record<EdgeState, StateCoverage>;

/**
 * The full inventory — refreshed 2026-06-11 against every (app) route
 * on disk. Statuses record REALITY (what each screen renders today),
 * not aspiration. The `covered-by-pr-52` transitional literal is gone:
 * PR #52 (`feat/d039-senders-tightening-pass-1`) merged 2026-05-25,
 * and the senders surfaces' actual coverage is recorded directly.
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
      // `composeTriageState` branches error FIRST (before loading) —
      // the launch-gap audit's "no isError branch" fix — and the
      // ErrorState story renders the designed retry surface.
      required: true,
      storybook: 'apps/web/src/features/triage/triage-screen.stories.tsx',
      status: 'covered',
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
      // Layout-mounted GracePeriodBanner (U-NAV) — renders above every
      // (app) screen while a deletion request is pending (D216).
      required: false,
      implementation: 'apps/web/src/app/(app)/layout.tsx',
      status: 'implemented',
    },
    placeholder: { required: false, status: 'n/a' },
  },

  // Senders — screen-level loading / empty / error branches ship in
  // `senders-screen.tsx` (the D211 skeleton, the grid-mode EmptyState
  // pair, and the retry ErrorState). Table-mode variants ARE storied
  // at component level (`sender-table.stories.tsx`: Loading,
  // ErrorState, EmptyNoSenders / NoFilterMatch / NoSearchMatch), but
  // no story renders the full screen in these states — hence
  // `implemented`, not `covered`.
  senders: {
    loading: {
      required: true,
      implementation: 'apps/web/src/features/senders/senders-screen.tsx',
      status: 'implemented',
    },
    empty: {
      required: true,
      implementation: 'apps/web/src/features/senders/senders-screen.tsx',
      status: 'implemented',
    },
    error: {
      required: true,
      implementation: 'apps/web/src/features/senders/senders-screen.tsx',
      status: 'implemented',
    },
    'partial-error': { required: false, status: 'n/a' },
    offline: { required: false, status: 'todo' },
    unauthorized: { required: false, status: 'todo' },
    'sync-in-progress': { required: false, status: 'todo' },
    'sync-failed-transient': { required: false, status: 'todo' },
    'quota-exceeded': { required: false, status: 'todo' },
    'free-cap-reached': { required: false, status: 'todo' },
    'sender-deleted-upstream': { required: false, status: 'n/a' },
    'account-deletion-pending': {
      // Layout-mounted GracePeriodBanner (U-NAV) — renders above every
      // (app) screen while a deletion request is pending (D216).
      required: false,
      implementation: 'apps/web/src/app/(app)/layout.tsx',
      status: 'implemented',
    },
    placeholder: { required: false, status: 'n/a' },
  },

  'sender-detail': {
    loading: {
      required: true,
      storybook: 'apps/web/src/features/senders/detail/sender-detail-page.stories.tsx',
      status: 'covered',
    },
    empty: {
      // "Sender exists but no recent messages" — the Empty story.
      required: true,
      storybook: 'apps/web/src/features/senders/detail/sender-detail-page.stories.tsx',
      status: 'covered',
    },
    error: {
      required: true,
      storybook: 'apps/web/src/features/senders/detail/sender-detail-page.stories.tsx',
      status: 'covered',
    },
    'partial-error': {
      // Child-query failures (messages / timeseries / history)
      // deliberately collapse to the full-screen error with retry —
      // there is no partial-render design for this screen.
      required: false,
      status: 'n/a',
    },
    offline: { required: false, status: 'todo' },
    unauthorized: { required: false, status: 'todo' },
    'sync-in-progress': { required: false, status: 'n/a' },
    'sync-failed-transient': { required: false, status: 'n/a' },
    'quota-exceeded': { required: false, status: 'n/a' },
    'free-cap-reached': { required: false, status: 'n/a' },
    'sender-deleted-upstream': {
      // BE 404 → `NotFoundState` ("sender no longer exists / unknown
      // id") in the route container. No dedicated story.
      required: true,
      implementation: 'apps/web/src/features/senders/detail/sender-detail-page.tsx',
      status: 'implemented',
    },
    'account-deletion-pending': {
      // Layout-mounted GracePeriodBanner (U-NAV) — renders above every
      // (app) screen while a deletion request is pending (D216).
      required: false,
      implementation: 'apps/web/src/app/(app)/layout.tsx',
      status: 'implemented',
    },
    placeholder: { required: false, status: 'n/a' },
  },

  // Activity feed (D55–D60). Empty is storied; loading skeleton and
  // the 4xx-vs-5xx ErrorState ship in code only. With U27 infinite
  // scroll (D57), a failed fetchNextPage keeps the loaded pages on
  // screen + renders an inline retry in <LoadMoreRegion> — that IS
  // the partial-error state (some rows loaded, some did not).
  activity: {
    loading: {
      required: true,
      implementation: 'apps/web/src/features/activity/activity-screen.tsx',
      status: 'implemented',
    },
    empty: {
      required: true,
      storybook: 'apps/web/src/features/activity/activity-screen.stories.tsx',
      status: 'covered',
    },
    error: {
      required: true,
      implementation: 'apps/web/src/features/activity/activity-screen.tsx',
      status: 'implemented',
    },
    'partial-error': {
      required: true,
      implementation: 'apps/web/src/features/activity/activity-screen.tsx',
      status: 'implemented',
    },
    offline: { required: false, status: 'todo' },
    unauthorized: { required: false, status: 'todo' },
    'sync-in-progress': { required: false, status: 'todo' },
    'sync-failed-transient': { required: false, status: 'todo' },
    'quota-exceeded': { required: false, status: 'n/a' },
    'free-cap-reached': { required: false, status: 'n/a' },
    'sender-deleted-upstream': { required: false, status: 'n/a' },
    'account-deletion-pending': {
      // Layout-mounted GracePeriodBanner (U-NAV) — renders above every
      // (app) screen while a deletion request is pending (D216).
      required: false,
      implementation: 'apps/web/src/app/(app)/layout.tsx',
      status: 'implemented',
    },
    placeholder: { required: false, status: 'n/a' },
  },

  // Autopilot (D99–D105). All three core states are storied
  // (Loading / Error / Empty + EmptyNoRules) across BOTH sections of
  // the screen — the D101 rules-management list and the D104 pending-
  // suggestions buffer share the same top-level state machine, so one
  // row covers both. Guard 409s (SELECT_MAILBOX / NO_ACTIVE_MAILBOX)
  // render the layout-owned designed state, never a retry.
  autopilot: {
    loading: {
      required: true,
      storybook: 'apps/web/src/features/autopilot/autopilot-screen.stories.tsx',
      status: 'covered',
    },
    empty: {
      required: true,
      storybook: 'apps/web/src/features/autopilot/autopilot-screen.stories.tsx',
      status: 'covered',
    },
    error: {
      required: true,
      storybook: 'apps/web/src/features/autopilot/autopilot-screen.stories.tsx',
      status: 'covered',
    },
    'partial-error': { required: false, status: 'n/a' },
    offline: { required: false, status: 'todo' },
    unauthorized: { required: false, status: 'todo' },
    'sync-in-progress': { required: false, status: 'todo' },
    'sync-failed-transient': { required: false, status: 'todo' },
    'quota-exceeded': { required: false, status: 'n/a' },
    'free-cap-reached': { required: false, status: 'n/a' },
    'sender-deleted-upstream': { required: false, status: 'n/a' },
    'account-deletion-pending': {
      // Layout-mounted GracePeriodBanner (U-NAV) — renders above every
      // (app) screen while a deletion request is pending (D216).
      required: false,
      implementation: 'apps/web/src/app/(app)/layout.tsx',
      status: 'implemented',
    },
    placeholder: { required: false, status: 'n/a' },
  },

  // Daily Brief (D61–D70). Empty = the storied D70 QuietInbox.
  // Loading skeleton + ErrorState ship in code only. The BE 404
  // ("snapshot not generated yet" — fresh connect or tail UTC offset)
  // renders the designed `NotYetState`, recorded under
  // sync-in-progress as the closest D211 semantic.
  brief: {
    loading: {
      required: true,
      implementation: 'apps/web/src/features/brief/brief-screen.tsx',
      status: 'implemented',
    },
    empty: {
      required: true,
      storybook: 'apps/web/src/features/brief/brief-screen.stories.tsx',
      status: 'covered',
    },
    error: {
      required: true,
      implementation: 'apps/web/src/features/brief/brief-screen.tsx',
      status: 'implemented',
    },
    'partial-error': { required: false, status: 'n/a' },
    offline: { required: false, status: 'todo' },
    unauthorized: { required: false, status: 'todo' },
    'sync-in-progress': {
      // `NotYetState` — 404 from the BE means the snapshot worker
      // hasn't fired for this mailbox yet (includes freshly-connected
      // accounts mid-initial-sync).
      required: false,
      implementation: 'apps/web/src/features/brief/brief-screen.tsx',
      status: 'implemented',
    },
    'sync-failed-transient': { required: false, status: 'todo' },
    'quota-exceeded': { required: false, status: 'n/a' },
    'free-cap-reached': { required: false, status: 'n/a' },
    'sender-deleted-upstream': { required: false, status: 'n/a' },
    'account-deletion-pending': {
      // Layout-mounted GracePeriodBanner (U-NAV) — renders above every
      // (app) screen while a deletion request is pending (D216).
      required: false,
      implementation: 'apps/web/src/app/(app)/layout.tsx',
      status: 'implemented',
    },
    placeholder: { required: false, status: 'n/a' },
  },

  // Followups (D90, D91). Empty is storied (D91 copy verbatim);
  // loading + error ship in code only.
  followups: {
    loading: {
      required: true,
      implementation: 'apps/web/src/features/followups/followups-screen.tsx',
      status: 'implemented',
    },
    empty: {
      required: true,
      storybook: 'apps/web/src/features/followups/followups-screen.stories.tsx',
      status: 'covered',
    },
    error: {
      required: true,
      implementation: 'apps/web/src/features/followups/followups-screen.tsx',
      status: 'implemented',
    },
    'partial-error': { required: false, status: 'n/a' },
    offline: { required: false, status: 'todo' },
    unauthorized: { required: false, status: 'todo' },
    'sync-in-progress': { required: false, status: 'todo' },
    'sync-failed-transient': { required: false, status: 'todo' },
    'quota-exceeded': { required: false, status: 'n/a' },
    'free-cap-reached': { required: false, status: 'n/a' },
    'sender-deleted-upstream': { required: false, status: 'n/a' },
    'account-deletion-pending': {
      // Layout-mounted GracePeriodBanner (U-NAV) — renders above every
      // (app) screen while a deletion request is pending (D216).
      required: false,
      implementation: 'apps/web/src/app/(app)/layout.tsx',
      status: 'implemented',
    },
    placeholder: { required: false, status: 'n/a' },
  },

  // Standing sender policies (Phase X3) — /settings/senders. All
  // three core states ship in code; no stories file exists for this
  // screen yet.
  'settings-senders': {
    loading: {
      required: true,
      implementation: 'apps/web/src/features/settings/senders-policies/senders-policies-screen.tsx',
      status: 'implemented',
    },
    empty: {
      required: true,
      implementation: 'apps/web/src/features/settings/senders-policies/senders-policies-screen.tsx',
      status: 'implemented',
    },
    error: {
      required: true,
      implementation: 'apps/web/src/features/settings/senders-policies/senders-policies-screen.tsx',
      status: 'implemented',
    },
    'partial-error': { required: false, status: 'n/a' },
    offline: { required: false, status: 'todo' },
    unauthorized: { required: false, status: 'todo' },
    'sync-in-progress': { required: false, status: 'todo' },
    'sync-failed-transient': { required: false, status: 'todo' },
    'quota-exceeded': { required: false, status: 'n/a' },
    'free-cap-reached': { required: false, status: 'n/a' },
    'sender-deleted-upstream': { required: false, status: 'n/a' },
    'account-deletion-pending': {
      // Layout-mounted GracePeriodBanner (U-NAV) — renders above every
      // (app) screen while a deletion request is pending (D216).
      required: false,
      implementation: 'apps/web/src/app/(app)/layout.tsx',
      status: 'implemented',
    },
    placeholder: { required: false, status: 'n/a' },
  },

  // Operator audit log (D181 read) — /admin/security. All states
  // storied, including the deliberate not-an-admin 404 surface
  // (recorded under `unauthorized`: `AdminAllowlistGuard` refuses
  // with 404 so the route's purpose is never revealed). Sync / quota
  // / tier states don't apply to an operator-only DB read.
  'admin-security': {
    loading: {
      required: true,
      storybook: 'apps/web/src/features/admin-security/security-events-screen.stories.tsx',
      status: 'covered',
    },
    empty: {
      required: true,
      storybook: 'apps/web/src/features/admin-security/security-events-screen.stories.tsx',
      status: 'covered',
    },
    error: {
      required: true,
      storybook: 'apps/web/src/features/admin-security/security-events-screen.stories.tsx',
      status: 'covered',
    },
    'partial-error': { required: false, status: 'n/a' },
    offline: { required: false, status: 'n/a' },
    unauthorized: {
      // NotFound story — non-allowlisted callers get the 404 surface.
      required: true,
      storybook: 'apps/web/src/features/admin-security/security-events-screen.stories.tsx',
      status: 'covered',
    },
    'sync-in-progress': { required: false, status: 'n/a' },
    'sync-failed-transient': { required: false, status: 'n/a' },
    'quota-exceeded': { required: false, status: 'n/a' },
    'free-cap-reached': { required: false, status: 'n/a' },
    'sender-deleted-upstream': { required: false, status: 'n/a' },
    'account-deletion-pending': { required: false, status: 'n/a' },
    placeholder: { required: false, status: 'n/a' },
  },

  // ── Placeholder routes ──────────────────────────────────────────
  // Static server-rendered `RoutePlaceholder` stubs (no data fetch →
  // no loading / empty / error of their own). The placeholder IS the
  // one designed state each ships; variants live in the shared
  // route-placeholder stories file.

  billing: {
    loading: { required: false, status: 'n/a' },
    empty: { required: false, status: 'n/a' },
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
    placeholder: {
      required: true,
      storybook: 'apps/web/src/features/route-placeholder/route-placeholder.stories.tsx',
      status: 'covered',
    },
  },

  // Quiet hours config (U18 — D92/D95). Per-mailbox cards, each with
  // its own loading/error branch; `empty` = no connected mailboxes.
  quiet: {
    loading: {
      required: true,
      storybook: 'apps/web/src/features/quiet/quiet-hours-card.stories.tsx',
      status: 'covered',
    },
    empty: {
      // "No mailboxes connected" EmptyState branch in the screen —
      // exercised by unit tests; no dedicated story (the shared
      // EmptyState component carries its own stories).
      required: true,
      implementation: 'apps/web/src/features/quiet/quiet-screen.tsx',
      status: 'implemented',
    },
    error: {
      required: true,
      storybook: 'apps/web/src/features/quiet/quiet-hours-card.stories.tsx',
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
    placeholder: { required: false, status: 'n/a' },
  },

  screener: {
    loading: { required: false, status: 'n/a' },
    empty: { required: false, status: 'n/a' },
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
    placeholder: {
      required: true,
      storybook: 'apps/web/src/features/route-placeholder/route-placeholder.stories.tsx',
      status: 'covered',
    },
  },

  // Settings index (U23 — D34/D114/D116/D216). Graduated from a
  // RoutePlaceholder stub 2026-06-11. Per-card loading/error branches
  // (me-settings + billing queries each render their own retry state);
  // `empty` = the zero-mailboxes branch in the Mailboxes card. The
  // account-deletion-pending state is the #218 deletion section's
  // PendingState (date + cancel) rendered inside this screen.
  'settings-index': {
    loading: {
      required: true,
      implementation: 'apps/web/src/features/settings/settings-index/settings-screen.tsx',
      status: 'implemented',
    },
    empty: {
      required: true,
      implementation: 'apps/web/src/features/settings/settings-index/mailboxes-card.tsx',
      status: 'implemented',
    },
    error: {
      required: true,
      implementation: 'apps/web/src/features/settings/settings-index/settings-screen.tsx',
      status: 'implemented',
    },
    'partial-error': {
      // One card's query failing renders that card's retry state while
      // the rest of the page stays usable — partial by construction.
      required: false,
      implementation: 'apps/web/src/features/settings/settings-index/settings-screen.tsx',
      status: 'implemented',
    },
    offline: { required: false, status: 'todo' },
    unauthorized: { required: false, status: 'todo' },
    'sync-in-progress': {
      // Per-mailbox "Syncing…" tag in the Mailboxes card.
      required: false,
      implementation: 'apps/web/src/features/settings/settings-index/mailboxes-card.tsx',
      status: 'implemented',
    },
    'sync-failed-transient': {
      required: false,
      implementation: 'apps/web/src/features/settings/settings-index/mailboxes-card.tsx',
      status: 'implemented',
    },
    'quota-exceeded': { required: false, status: 'n/a' },
    'free-cap-reached': { required: false, status: 'n/a' },
    'sender-deleted-upstream': { required: false, status: 'n/a' },
    'account-deletion-pending': {
      required: true,
      implementation: 'apps/web/src/features/account-deletion/account-deletion-section.tsx',
      status: 'implemented',
    },
    placeholder: { required: false, status: 'n/a' },
  },

  // Privacy & Data sub-page (D116/D217/D228). Largely static trust
  // copy (the PrivacyBadge card) + data from the already-resolved auth
  // provider — no full-screen loading/error of its own. `error` is the
  // export-failed inline alert; `empty` = zero indexed mailboxes.
  'settings-privacy': {
    loading: { required: false, status: 'n/a' },
    empty: {
      required: false,
      implementation: 'apps/web/src/features/settings/privacy-data/privacy-data-screen.tsx',
      status: 'implemented',
    },
    error: {
      required: true,
      implementation: 'apps/web/src/features/settings/privacy-data/privacy-data-screen.tsx',
      status: 'implemented',
    },
    'partial-error': { required: false, status: 'n/a' },
    offline: { required: false, status: 'todo' },
    unauthorized: { required: false, status: 'todo' },
    'sync-in-progress': { required: false, status: 'n/a' },
    'sync-failed-transient': { required: false, status: 'n/a' },
    'quota-exceeded': { required: false, status: 'n/a' },
    'free-cap-reached': { required: false, status: 'n/a' },
    'sender-deleted-upstream': { required: false, status: 'n/a' },
    'account-deletion-pending': { required: false, status: 'n/a' },
    placeholder: { required: false, status: 'n/a' },
  },

  // Snoozed/Later review surface (D78–D80) — real loading/empty/error
  // variants; no placeholder phase.
  snoozed: {
    loading: {
      required: true,
      storybook: 'apps/web/src/features/snoozed/snoozed-screen.stories.tsx',
      status: 'covered',
    },
    empty: {
      required: true,
      storybook: 'apps/web/src/features/snoozed/snoozed-screen.stories.tsx',
      status: 'covered',
    },
    error: {
      required: true,
      storybook: 'apps/web/src/features/snoozed/snoozed-screen.stories.tsx',
      status: 'covered',
    },
    'partial-error': {
      // The mirror-degraded "count syncing…" variant (CountSyncing
      // story) — rows render, counts are honestly unknown.
      required: false,
      storybook: 'apps/web/src/features/snoozed/snoozed-screen.stories.tsx',
      status: 'covered',
    },
    offline: { required: false, status: 'todo' },
    unauthorized: { required: false, status: 'todo' },
    'sync-in-progress': { required: false, status: 'todo' },
    'sync-failed-transient': { required: false, status: 'todo' },
    'quota-exceeded': { required: false, status: 'todo' },
    'free-cap-reached': { required: false, status: 'todo' },
    'sender-deleted-upstream': { required: false, status: 'n/a' },
    'account-deletion-pending': {
      // Layout-mounted GracePeriodBanner (U-NAV) — renders above every
      // (app) screen while a deletion request is pending (D216).
      required: false,
      implementation: 'apps/web/src/app/(app)/layout.tsx',
      status: 'implemented',
    },
    placeholder: { required: false, status: 'n/a' },
  },

  // ── App Router error surfaces (D167) ────────────────────────────

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
    placeholder: { required: false, status: 'n/a' },
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
    placeholder: { required: false, status: 'n/a' },
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
    placeholder: { required: false, status: 'n/a' },
  },
};

export type EdgeStateInventory = typeof EDGE_STATE_INVENTORY;
