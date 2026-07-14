/**
 * Triage feature — fixtures + pure helpers.
 *
 * The fixtures here are deterministic projections of what the real API
 * will return once `apps/api` wires the triage query module: a join
 * between `triage_decisions` (D20 — verdict + confidence + reasoning)
 * and `senders` (display name + Gmail category + unsubscribe method).
 *
 * Privacy (D7 / D228): no body fields. Each decision references its
 * sender by `senderKey` and surfaces only metadata — sender identity,
 * Gmail category, volume / read aggregates, the engine's verdict, and
 * the reasoning copy (D24 — Haiku output or deterministic template).
 *
 * D222 reminder: we record VERDICTs, never categories. The Gmail
 * `gmailCategory` field is Gmail's own classification, not a learned
 * prediction.
 *
 * D227 reminder: verdicts are stored as the lowercase enum
 * (`keep | archive | unsubscribe | later`) — the user-facing labels
 * (Keep / Archive / Unsubscribe / Later) are derived at render time.
 *
 * Fixtures are static so Storybook variants stay byte-stable.
 */

import type { TriageVerdict } from './types';

/** Gmail-side category — surfaces in row chrome (read-only). Mirrored
 * from the canonical `gmail_category` pg_enum via the shared contracts
 * package so a migration that widens the enum widens this type. */
export type { GmailCategory } from '@declutrmail/shared/contracts';
import type { GmailCategory } from '@declutrmail/shared/contracts';

/**
 * RFC 8058 unsubscribe capability per sender (mirrors
 * `senders.unsubscribe_method`). `one_click` automates cleanly;
 * `mailto` defers per D230 ("Mailto unsubscribe is manual at launch");
 * `none` falls back to manual.
 */
export type UnsubscribeMethod = 'one_click' | 'mailto' | 'none';

/** Why a sender's verdict is locked to Keep — surfaces in the row. */
export type ProtectionReason = 'user-marked' | 'engagement' | 'auto-receipts' | 'auto-financial';

/**
 * One row in the triage queue — sender identity + engine verdict +
 * supporting signals + protection posture.
 *
 * Field naming mirrors the BE projection so swapping fixtures for a
 * real `useTriageQueueQuery()` is a one-line change (move from
 * `import { TRIAGE_QUEUE } from './data'` to a TanStack Query call).
 */
export interface TriageDecisionRow {
  /** Stable id — `${senderKey}` in real data; opaque token in fixtures. */
  id: string;
  /**
   * `senders.id` uuid — the selector `POST /api/actions` takes (the BE
   * resolves it to `sender_key` server-side, which also enforces
   * ownership). Carried on the row so confirming a verb never needs a
   * second lookup (D226 wiring). Opaque token in fixtures.
   */
  senderId: string;
  /** sha256("v1|" + normalized_email), hex — matches `senders.sender_key`. */
  senderKey: string;
  senderName: string;
  senderEmail: string;
  senderDomain: string;
  gmailCategory: GmailCategory;
  /** Best unsubscribe method seen across the sender's messages. */
  unsubscribeMethod: UnsubscribeMethod;

  /** Engine verdict — D21 cascade output. */
  verdict: TriageVerdict;
  /** Engine confidence in `[0.00, 1.00]`. ≥0.85 highlights per D31. */
  confidence: number;
  /** D24 reasoning copy — LLM (Haiku) or template fallback. */
  reasoning: string;
  /** Supporting signals — bullet list in the expanded row. */
  signals: string[];

  /**
   * Why the verdict is locked to Keep. Non-null means the engine's
   * Phase A protection ran (user-marked, engagement, auto-receipts, etc.) —
   * destructive verbs are disabled for these rows.
   */
  protectionReason: ProtectionReason | null;

  /** Volume signal — messages/month, recent cadence (4-week average). */
  monthlyVolume: number;
  /**
   * Raw last-90-day message count. Lets the FE render an honest
   * rolling-window signal ("N in last 90d") instead of the derived
   * `monthlyVolume = round(last90 / 3)`, which rounds to 0 for senders
   * quiet within the window (FOUNDER 2026-06-06 smoke — every row read
   * "0/mo" because the only mail from those senders was older than 90d).
   */
  last90dMessages: number;
  /** Read rate in `[0, 1]`. */
  readRate: number;
  /** Days since the sender's most recent message. */
  lastDays: number;
  /** Approximate lifetime received count from this sender. */
  totalAllTime: number;
}

/** Snapshot stats for the empty state copy — "today you Kept N senders, etc." */
export interface TriageSessionStats {
  decidedToday: number;
  archivedToday: number;
  unsubscribedToday: number;
  laterToday: number;
  /** Active streak of consecutive days the user has cleared their queue. */
  streakDays: number;
  /** Free-tier remaining decisions for the day (D33 upgrade nudge). */
  freeRemaining: number | null;
  /**
   * D33 estimated impact — projected from today's decided senders'
   * monthly volume. The BE computes these so the FE doesn't fake
   * numbers (no fake completion per CLAUDE.md §10).
   *
   *   futureEmailsSkipped — annualised count of inbox messages
   *     deflected by today's decisions (monthly_volume × 12 for each
   *     archived / unsubscribed / later-routed sender).
   *
   *   minutesSavedPerWeek — coarse triage-time projection from the
   *     same volume; ~6s per skipped email rounded to the nearest
   *     minute (cf. D33 worked example: "~12 min/week saved").
   *
   * Both fields are `null` when the user has decided nothing today —
   * the impact card doesn't render in that case so we never show
   * "0 emails skipped" as a hollow brag.
   */
  futureEmailsSkipped: number | null;
  minutesSavedPerWeek: number | null;
  /**
   * D33 tier-gated nudge — surfaces a subtle Plus or Pro link in
   * the empty state. `null` for Pro users (no nudge; D33: "Hidden
   * for Pro users"). See D17–D21 for the tier ladder.
   */
  tier: 'free' | 'plus' | 'pro';
}

/**
 * Loading / empty / ready / error — closed union, no `string` fallback.
 *
 * `error` carries the failed query's error (an `ApiError` in practice)
 * plus a `retry` callback the page composes from the queries' refetch.
 * Reads do NOT auto-retry 4xx (the `makeQueryClient` invariant — guard
 * 409s are designed states handled at layout level); the explicit
 * "Try again" affordance is the only retry path.
 */
export type TriageScreenState =
  | { kind: 'loading' }
  | { kind: 'empty'; stats: TriageSessionStats }
  | { kind: 'ready'; rows: TriageDecisionRow[]; stats: TriageSessionStats }
  | { kind: 'error'; error: unknown; retry: () => void };

/**
 * Deterministic fixture — 9 rows that cover the edge cases the
 * Storybook variants and tests reason about:
 *
 *   • 2 Keep   — one user-protected, one engagement-protected
 *   • 3 Archive — varied confidence (0.94 / 0.88 / 0.66)
 *   • 3 Unsubscribe — one one-click (D9), one mailto (D230 deferred),
 *     one with NO channel (`unsubscribeMethod: 'none'`) — the live
 *     shape the 2026-07-02 audit caught (W2/W3): recommended verb
 *     disabled + quiet-90d sender.
 *   • 1 Later
 *
 * Ordering is "highest impact first" (Archive/Unsubscribe at the top,
 * Keep at the bottom). The engine in production sorts by a different
 * key — fixtures here just need to be stable and varied. New rows are
 * APPENDED (not impact-sorted) because sibling tests pin rows by index
 * (`TRIAGE_QUEUE[0]`/`[1]` in action-sheet + screen-actions tests).
 */
export const TRIAGE_QUEUE: readonly TriageDecisionRow[] = [
  // ── Archive · high confidence (0.94) ─────────────────────────────
  {
    id: 't-groupon',
    senderId: 'sid-groupon',
    senderKey: 'sk_groupon',
    senderName: 'Groupon',
    senderEmail: 'noreply@groupon.com',
    senderDomain: 'groupon.com',
    gmailCategory: 'promotions',
    unsubscribeMethod: 'one_click',
    verdict: 'archive',
    confidence: 0.94,
    reasoning: "You open 0% of Groupon's 52/mo. Volume is high and they send most days.",
    signals: [
      'Read rate: 0% over the last 90 days',
      'Volume: 52 messages/month (4-week trailing average)',
      "Volume spike: 3× the sender's usual cadence",
      'No reply from you to this sender in the last 12 months',
    ],
    protectionReason: null,
    monthlyVolume: 52,
    last90dMessages: 156,
    readRate: 0,
    lastDays: 0,
    totalAllTime: 1745,
  },

  // ── Unsubscribe · one-click (D9 happy path) ──────────────────────
  {
    id: 't-linkedin',
    senderId: 'sid-linkedin',
    senderKey: 'sk_linkedin',
    senderName: 'LinkedIn',
    senderEmail: 'notifications-noreply@linkedin.com',
    senderDomain: 'linkedin.com',
    gmailCategory: 'social',
    unsubscribeMethod: 'one_click',
    verdict: 'unsubscribe',
    confidence: 0.91,
    reasoning: 'Volume spiked 2× while you almost never opened (0% read).',
    signals: [
      'Read rate: 0% over the last 90 days',
      'Volume: 64 messages/month (4-week trailing average)',
      "Volume spike: 2× the sender's usual cadence",
      // Locked-copy ban per spec v1.2 Decision 15: jargon-free phrasing.
      'One-click unsubscribe available',
    ],
    protectionReason: null,
    monthlyVolume: 64,
    last90dMessages: 192,
    readRate: 0,
    lastDays: 0,
    totalAllTime: 2432,
  },

  // ── Archive · medium confidence (0.88) ───────────────────────────
  {
    id: 't-oldnavy',
    senderId: 'sid-oldnavy',
    senderKey: 'sk_oldnavy',
    senderName: 'Old Navy',
    senderEmail: 'help@oldnavy.com',
    senderDomain: 'oldnavy.com',
    gmailCategory: 'promotions',
    unsubscribeMethod: 'one_click',
    verdict: 'archive',
    confidence: 0.88,
    reasoning: "You open 0% of Old Navy's 48/mo. They send most days.",
    signals: [
      'Read rate: 0% over the last 90 days',
      'Volume: 48 messages/month',
      "Volume spike: 3× the sender's usual cadence",
    ],
    protectionReason: null,
    monthlyVolume: 48,
    last90dMessages: 144,
    readRate: 0,
    lastDays: 0,
    totalAllTime: 1056,
  },

  // ── Unsubscribe · mailto only (D230 deferred path) ───────────────
  {
    id: 't-django',
    senderId: 'sid-django',
    senderKey: 'sk_django',
    senderName: 'django-users',
    senderEmail: 'django-users@googlegroups.com',
    senderDomain: 'googlegroups.com',
    gmailCategory: 'forums',
    unsubscribeMethod: 'mailto',
    verdict: 'unsubscribe',
    confidence: 0.86,
    reasoning: '46/mo at 4% read — this list mostly fills the inbox without being seen.',
    signals: [
      'Read rate: 4% over the last 90 days',
      'Volume: 46 messages/month',
      // Locked-copy ban per spec v1.2 Decision 15: jargon-free phrasing.
      'Unsubscribe is by reply only (no one-click option)',
      'No reply from you to this thread in the last 6 months',
    ],
    protectionReason: null,
    monthlyVolume: 46,
    last90dMessages: 138,
    readRate: 0.04,
    lastDays: 0,
    totalAllTime: 4692,
  },

  // ── Archive · low confidence (0.66) — recommendation NOT highlighted
  {
    id: 't-nextdoor',
    senderId: 'sid-nextdoor',
    senderKey: 'sk_nextdoor',
    senderName: 'Nextdoor',
    senderEmail: 'notifications@nextdoor.com',
    senderDomain: 'nextdoor.com',
    gmailCategory: 'social',
    unsubscribeMethod: 'one_click',
    verdict: 'archive',
    confidence: 0.66,
    reasoning: '12/mo at 30% read — high enough cadence to triage, low enough engagement to clear.',
    signals: ['Read rate: 30% over the last 90 days', 'Volume: 12 messages/month'],
    protectionReason: null,
    monthlyVolume: 12,
    last90dMessages: 36,
    readRate: 0.3,
    lastDays: 4,
    totalAllTime: 264,
  },

  // ── Later — moderate engagement, low cadence ─────────────────────
  {
    id: 't-substack',
    senderId: 'sid-substack',
    senderKey: 'sk_substack',
    senderName: 'Letters of Note',
    senderEmail: 'lon@substack.com',
    senderDomain: 'substack.com',
    gmailCategory: 'promotions',
    unsubscribeMethod: 'one_click',
    verdict: 'later',
    confidence: 0.78,
    reasoning:
      "8/mo at 85% read — when you do open these you read them, but they don't need to interrupt your day.",
    signals: [
      'Read rate: 85% over the last 90 days',
      'Volume: 8 messages/month',
      '"Later" keeps the mail in Gmail but stops surfacing it in your daily queue',
    ],
    protectionReason: null,
    monthlyVolume: 8,
    last90dMessages: 24,
    readRate: 0.85,
    lastDays: 3,
    totalAllTime: 96,
  },

  // ── Keep · user-protected ────────────────────────────────────────
  {
    id: 't-sarah',
    senderId: 'sid-sarah',
    senderKey: 'sk_sarah',
    senderName: 'Sarah Chen',
    senderEmail: 'sarah.chen@google.com',
    senderDomain: 'google.com',
    gmailCategory: 'primary',
    unsubscribeMethod: 'none',
    verdict: 'keep',
    confidence: 0.95,
    reasoning: 'Protected — every message from Sarah stays in the inbox.',
    signals: [
      'Protected since 2024-02-11 (you marked them)',
      'Read rate: 100% over the last 90 days',
      'Volume: 17 messages/month',
    ],
    protectionReason: 'user-marked',
    monthlyVolume: 17,
    last90dMessages: 51,
    readRate: 1,
    lastDays: 0,
    totalAllTime: 306,
  },

  // ── Keep · engagement-protected (>=70% read) ─────────────────────
  {
    id: 't-priya',
    senderId: 'sid-priya',
    senderKey: 'sk_priya',
    senderName: 'Priya Raman',
    senderEmail: 'priya@hey.com',
    senderDomain: 'hey.com',
    gmailCategory: 'primary',
    unsubscribeMethod: 'none',
    verdict: 'keep',
    confidence: 0.88,
    reasoning: "You read 95% of Priya's mail. No change recommended.",
    signals: [
      'Read rate: 95% over the last 90 days',
      'Volume: 6 messages/month',
      'Engagement-protected (read rate ≥ 70%) — destructive verbs hidden',
    ],
    protectionReason: 'engagement',
    monthlyVolume: 6,
    last90dMessages: 18,
    readRate: 0.95,
    lastDays: 2,
    totalAllTime: 84,
  },

  // ── Unsubscribe · NO channel (`unsubscribeMethod: 'none'`) ────────
  // Mirrors the live queue shape the 2026-07-02 audit flagged (W2/W3):
  // the engine recommends Unsubscribe at high confidence for a sender
  // with no List-Unsubscribe header, so the U pill is disabled — the
  // toolbar must explain why. Also quiet-90d (`last90dMessages: 0`)
  // with a stale `lastDays: 0`, the exact pair behind the
  // "Quiet 90d · 555 lifetime" vs "LAST SEEN today" contradiction.
  // Appended last so index-pinned tests (TRIAGE_QUEUE[0]/[1]) hold.
  {
    id: 't-shipping',
    senderId: 'sid-shipping',
    senderKey: 'sk_shipping',
    senderName: 'Shipment Tracking',
    senderEmail: 'shipment-tracking@bigstore.example',
    senderDomain: 'bigstore.example',
    gmailCategory: 'updates',
    unsubscribeMethod: 'none',
    verdict: 'unsubscribe',
    confidence: 0.95,
    reasoning:
      'Zero messages in the past 90 days at 0% read — this sender fills the archive without being seen.',
    signals: [
      'Read rate: 0% over the last 90 days',
      'Quiet: no messages in the last 90 days',
      'No unsubscribe channel advertised by this sender',
    ],
    protectionReason: null,
    monthlyVolume: 0,
    last90dMessages: 0,
    readRate: 0,
    lastDays: 0,
    totalAllTime: 555,
  },
];

/**
 * Snapshot used by the empty state — fixtures only. Defaults to the
 * Plus tier so the "Pro could do this for you automatically" link
 * surfaces in the empty-state Storybook story.
 */
export const TRIAGE_SESSION_STATS: TriageSessionStats = {
  decidedToday: 14,
  archivedToday: 6,
  unsubscribedToday: 3,
  laterToday: 2,
  streakDays: 5,
  freeRemaining: null,
  // 14 decisions × ~60/mo each × 12 months ≈ 10k — round to the
  // D33-style number so the fixture reads as believable not contrived.
  futureEmailsSkipped: 840,
  minutesSavedPerWeek: 12,
  tier: 'plus',
};

/** Free-tier snapshot used by the empty-state upgrade nudge story. */
export const TRIAGE_SESSION_STATS_FREE: TriageSessionStats = {
  decidedToday: 8,
  archivedToday: 4,
  unsubscribedToday: 2,
  laterToday: 2,
  streakDays: 2,
  freeRemaining: 2,
  futureEmailsSkipped: 480,
  minutesSavedPerWeek: 6,
  tier: 'free',
};

/**
 * Pro-tier snapshot — D33 says the upgrade nudge is "Hidden for Pro
 * users (replaced with a streak/momentum graphic)." This fixture
 * drives that variant.
 */
export const TRIAGE_SESSION_STATS_PRO: TriageSessionStats = {
  decidedToday: 14,
  archivedToday: 6,
  unsubscribedToday: 3,
  laterToday: 2,
  streakDays: 12,
  freeRemaining: null,
  futureEmailsSkipped: 1240,
  minutesSavedPerWeek: 18,
  tier: 'pro',
};

/**
 * Quiet snapshot — the queue is empty and the user decided NOTHING
 * today (fresh morning visit, or a new mailbox with no scored senders
 * yet). Drives the D212 resting empty state — the D33 "you cleared
 * today's queue" celebration would be false here (a grid of four
 * zeros under a claim the user cleared something). Mirrors the live
 * `/api/triage/stats` payload observed 2026-07-02.
 */
export const TRIAGE_SESSION_STATS_QUIET: TriageSessionStats = {
  decidedToday: 0,
  archivedToday: 0,
  unsubscribedToday: 0,
  laterToday: 0,
  streakDays: 0,
  freeRemaining: null,
  futureEmailsSkipped: null,
  minutesSavedPerWeek: null,
  tier: 'pro',
};

// ─── Capability gates ─────────────────────────────────────────────
// Mirrors the senders feature: protected rows can only be Kept;
// Unsubscribe is hidden when no `List-Unsubscribe` header was seen.

export function canArchive(row: TriageDecisionRow): boolean {
  return row.protectionReason === null;
}

export function canLater(row: TriageDecisionRow): boolean {
  return row.protectionReason === null;
}

/**
 * Unsubscribe is offered when the sender has any List-Unsubscribe
 * header and is not protected. `mailto` is rendered with a "manual
 * follow-up" hint per D230 — never auto-fired.
 */
export function canUnsubscribe(row: TriageDecisionRow): boolean {
  if (row.protectionReason !== null) return false;
  return row.unsubscribeMethod !== 'none';
}

/**
 * Display value for the "last seen" stat — derived so it can never
 * contradict the quiet-90d copy that `last90dMessages` drives (the
 * 2026-07-02 audit's W3: a row read "Quiet 90d · 555 lifetime" while
 * the stat card said "LAST SEEN today").
 *
 * When the sender has ZERO messages inside the rolling 90-day window,
 * any `lastDays < 90` is internally inconsistent — the aggregate
 * window is computed in SQL from real rows, while `lastDays` rides a
 * raw-SQL `MAX(internal_date)` that the BE currently collapses to `0`
 * (see the PR body — data-layer fix tracked separately). The window
 * wins: render "90d+" unless `lastDays` already agrees.
 */
export function lastSeenLabel(
  row: Pick<TriageDecisionRow, 'lastDays' | 'last90dMessages'>,
): string {
  if (row.last90dMessages === 0) {
    return row.lastDays >= 90 ? `${row.lastDays}d` : '90d+';
  }
  if (row.lastDays === 0) return 'today';
  if (row.lastDays === 1) return '1d';
  return `${row.lastDays}d`;
}

/** Compact "12.4k" formatter — matches senders/data.ts:fmtCompact. */
export function fmtCompact(n: number): string {
  if (n < 1000) return n.toLocaleString();
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}
