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

/**
 * The wire value, which is NULLABLE (D248): null means the sender index
 * has not derived a method yet. That is "not checked", not "no channel"
 * — the row must never claim we looked when we did not.
 */
export type StoredUnsubscribeMethod = UnsubscribeMethod | null;

/**
 * Why a sender's verdict is locked to Keep — surfaces in the row.
 *
 * These are the TRIAGE WIRE spellings, which is the point: this union
 * used to say `user-marked` while `TriageReadService.mapProtectionReason`
 * has always sent `manual`, so every user-protected row in production
 * carried a value outside its own type. Nothing caught it because the
 * fixtures used the type's spelling rather than the wire's.
 *
 * Display goes through `normalizeProtectionReason` in
 * `@declutrmail/shared/copy`, which resolves all three live dialects.
 */
export type ProtectionReason = 'manual' | 'replied' | 'starred' | 'gmail-important';

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
  /** Best unsubscribe method seen across the sender's messages, or
   *  null when the sender index has not derived one yet (D248). */
  unsubscribeMethod: StoredUnsubscribeMethod;

  /** Engine verdict — D21 cascade output. */
  verdict: TriageVerdict;
  /** Engine confidence in `[0.00, 1.00]`. Whether it counts as a
   *  recommendation is verdict-aware — see `RECOMMEND_FLOOR` (D31). */
  confidence: number;
  /** D24 reasoning copy — LLM (Haiku) or template fallback. */
  reasoning: string;
  /**
   * ISO-8601 — when the engine produced this read (D25).
   *
   * OPTIONAL because the demo fixtures and the public inbox simulator
   * have no engine run behind them. Absent means "no age to state",
   * which is why the label renders only when it is present — a
   * fabricated "scored just now" on a hand-written fixture would be the
   * same lie this field exists to remove.
   */
  scoredAt?: string;
  /**
   * Whether that read is past its TTL. Absent = unknown (fixtures),
   * which is NOT the same as fresh: unknown neither labels the row nor
   * triggers a refresh.
   */
  stale?: boolean;
  /** Evidence shown as a bullet list in the expanded row. */
  signals: string[];

  /**
   * Why the verdict is locked to Keep. Non-null means the engine's
   * Phase A protection ran (manual or an exact strong-signal reason).
   * Protected rows stay out of automatic and bulk cleanup, while the
   * user's explicit row actions remain available with confirmation.
   */
  protectionReason: ProtectionReason | null;
  /**
   * Does the recorded `protectionReason` still hold?
   *
   * `false` means the evidence is gone and this row is being surfaced
   * for the user to keep or unprotect — NOT that anything was
   * withdrawn. `null` (unmeasurable) and `undefined` (an API predating
   * the field) both mean "no claim", and render exactly as `true`.
   */
  protectionEvidenceCurrent?: boolean | null;

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
  /**
   * Read rate in `[0, 1]`, or `null` when the sender sent nothing in
   * the 90-day window — NOT 0.
   *
   * The BE has always typed this nullable; the FE typed it `number` and
   * every consumer did `Math.round(readRate * 100)`, which renders a
   * missing measurement as a confident "0% read". The expanded row card
   * showed exactly that. Unknown is a state, not a zero.
   */
  readRate: number | null;
  /** Days since the sender's most recent message. */
  lastDays: number;
  /** Inbound messages currently present in DeclutrMail's mailbox index. */
  totalAllTime: number;
  /**
   * Unread inbound messages sitting in the INBOX right now — the subset
   * of what an Archive / Later / Delete would move that Gmail has
   * never marked read.
   *
   * For a Protected sender this is what the protection is SHIELDING
   * from bulk and automatic cleanup, which is what makes a wrong
   * protection expensive. Resolved server-side from the same message
   * set the action preview counts, so the two can never disagree.
   *
   * Optional — the wire read is an unvalidated cast, web and API
   * deploy independently, and an older API omits the field. Required
   * here typed away a real runtime state; consumers were safe only by
   * accident of statement order. Absent ⇒ show nothing, never a
   * fabricated 0 (the senders wire types the same field the same way,
   * for the same reason).
   */
  unreadInboxCount?: number;
}

/** Snapshot stats for the empty state copy — "today you Kept N senders, etc." */
export interface TriageSessionStats {
  decidedToday: number;
  archivedToday: number;
  unsubscribedToday: number;
  laterToday: number;
  /** Free-tier remaining decisions for the day (D33 upgrade nudge). */
  freeRemaining: number | null;
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
 *   • 2 Keep   — one user-protected, one auto-protected (3+ replies)
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
    reasoning: "0% of Groupon's 52/mo is marked read. Volume is high and they send most days.",
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
    unreadInboxCount: 288,
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
    reasoning: 'Volume spiked 2× while almost nothing was marked read (0%).',
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
    unreadInboxCount: 372,
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
    reasoning: "0% of Old Navy's 48/mo is marked read. They send most days.",
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
    unreadInboxCount: 118,
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
    unreadInboxCount: 640,
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
    unreadInboxCount: 31,
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
    unreadInboxCount: 1,
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
    reasoning:
      'You marked Sarah as Protected, so DeclutrMail keeps this sender out of automatic and bulk cleanup.',
    signals: [
      'Protected since 2024-02-11 (you marked them)',
      'Read rate: 100% over the last 90 days',
      'Volume: 17 messages/month',
    ],
    protectionReason: 'manual',
    monthlyVolume: 17,
    last90dMessages: 51,
    readRate: 1,
    lastDays: 0,
    totalAllTime: 306,
    unreadInboxCount: 44,
  },

  // ── Keep · auto-protected (3+ replies, D245) ─────────────────────
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
      'Protected — automatic and bulk cleanup stays off because you wrote to them at least 3 times',
    ],
    protectionReason: 'replied',
    monthlyVolume: 6,
    last90dMessages: 18,
    readRate: 0.95,
    lastDays: 2,
    totalAllTime: 84,
    unreadInboxCount: 6,
  },

  // ── Unsubscribe · NO channel (`unsubscribeMethod: 'none'`) ────────
  // Mirrors the live queue shape the 2026-07-02 audit flagged (W2/W3):
  // the engine recommends Unsubscribe at high confidence for a sender
  // with no List-Unsubscribe header, so the U pill is disabled — the
  // toolbar must explain why. Also quiet-90d (`last90dMessages: 0`)
  // with a stale `lastDays: 0`, the exact pair behind the
  // "Quiet 90d · 555 received" vs "LAST SEEN today" contradiction.
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
    // Quiet within the window — the BE sends null, not 0.
    readRate: null,
    lastDays: 0,
    totalAllTime: 555,
    unreadInboxCount: 210,
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
  freeRemaining: null,
  tier: 'plus',
};

/** Free-tier snapshot used by the empty-state upgrade nudge story. */
export const TRIAGE_SESSION_STATS_FREE: TriageSessionStats = {
  decidedToday: 8,
  archivedToday: 4,
  unsubscribedToday: 2,
  laterToday: 2,
  freeRemaining: 2,
  tier: 'free',
};

/**
 * Pro-tier snapshot — the upgrade nudge is hidden for Pro users.
 */
export const TRIAGE_SESSION_STATS_PRO: TriageSessionStats = {
  decidedToday: 14,
  archivedToday: 6,
  unsubscribedToday: 3,
  laterToday: 2,
  freeRemaining: null,
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
  freeRemaining: null,
  tier: 'pro',
};

// ─── Capability gates ─────────────────────────────────────────────
// Mirrors the senders feature: an explicit single-row action is offered
// for every verb, and Unsubscribe is hidden only when no
// `List-Unsubscribe` header was seen (a fact, not a policy).
//
// These previously returned false for any protected row, which
// contradicted this feature's OWN server contract verbatim —
// `triage.read-service.ts` states that forcing the Keep RECOMMENDATION
// for a protected sender is "display-layer only … every K/A/U/L action
// remains available on the row". The gate was also client-only: the
// server has no protected check on the triage act path, so it blocked
// nothing an HTTP client couldn't do anyway.
//
// D245 excludes Protected senders from BULK and AUTOMATIC actions; the
// autopilot workers enforce that and are untouched. Triage rows are
// explicit single-sender intent behind the mandatory D226 preview.

export function canArchive(_row: TriageDecisionRow): boolean {
  return true;
}

export function canLater(_row: TriageDecisionRow): boolean {
  return true;
}

/**
 * Unsubscribe is offered when the sender has any List-Unsubscribe
 * header — a fact about the sender, not a policy. `mailto` is rendered
 * with a "manual follow-up" hint per D230 — never auto-fired.
 */
export function canUnsubscribe(row: TriageDecisionRow): boolean {
  // Requires a REAL channel, matching the Senders and Screener
  // predicates. `!== 'none'` was equivalent while the wire could not be
  // null; now that it can (D248), an un-indexed sender would have read
  // as unsubscribable and 409'd on the intent route.
  return row.unsubscribeMethod === 'one_click' || row.unsubscribeMethod === 'mailto';
}

/**
 * Display value for the "last seen" stat — derived so it can never
 * contradict the quiet-90d copy that `last90dMessages` drives (the
 * 2026-07-02 audit's W3: a row read "Quiet 90d · 555 received" while
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
  if (n < 1000) return n.toLocaleString('en-US');
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}
