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

import { renderTemplate, runCascade, type SenderSignals } from '@declutrmail/shared/triage-engine';

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
  /**
   * Whether the server already holds a brand mark for `senderDomain`
   * (ADR-0034). `false` means `Avatar` renders the monogram and makes NO
   * request — the point of the field, since a triage queue of unresolved
   * domains otherwise burns one 204 round trip per row on the coldest
   * cache in the product.
   */
  brandMark: boolean;
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
  lastDays: number | null;
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
 * A fixture before the engine runs: everything the row displays, minus
 * the three fields the cascade decides, plus the signals it decides from.
 *
 * `verdict`, `confidence` and `reasoning` used to be hand-written here.
 * That let the public demo show a recommendation the real engine would
 * never make, and it meant an engine change updated the product while the
 * demo went on describing the old behaviour (D133). Deriving them makes
 * that drift impossible by construction.
 *
 * `cascadeSignals` is deliberately NOT called `signals` — the row already
 * has a `signals: string[]` of display copy, and the two are unrelated.
 */
export type TriageFixtureSeed = Omit<
  TriageDecisionRow,
  'verdict' | 'confidence' | 'reasoning' | 'unsubscribeMethod'
> & {
  /**
   * Non-null on purpose. The wire type allows `null` for "the sender index
   * has not derived a method yet" (D248), which is NOT "no channel" — and
   * `SenderSignals.unsubscribeChannel` has no way to say "unknown". A
   * fixture that mapped null to `'none'` would claim we looked.
   */
  unsubscribeMethod: UnsubscribeMethod;
  cascadeSignals: SenderSignals;
};

/** Run one seed through the D21/D24 engine. Pure — same function the
 *  score worker calls, imported from `@declutrmail/shared/triage-engine`
 *  so the browser demo and the server can never compute different
 *  answers for the same signals. */
function buildFixtureRow(seed: TriageFixtureSeed): TriageDecisionRow {
  const { cascadeSignals, ...display } = seed;
  const result = runCascade(cascadeSignals);
  return {
    ...display,
    verdict: result.verdict,
    confidence: result.confidence,
    reasoning: renderTemplate(seed.senderName, result),
  };
}

/**
 * Fifteen seeds, run through the real D21/D24 engine (`buildFixtureRow`)
 * so `verdict`, `confidence` and `reasoning` are DERIVED, never
 * hand-written (D133). The first nine are the original fixture set; the
 * last six are a contiguous `amazon.com` run added for Plan 4's
 * domain-batch card (see the block comment above `t-amazon-main`).
 *
 * D133 RESOLVED (2026-08-26). Five of the original nine fixtures were
 * hand-written to a verdict the real cascade did NOT produce from their
 * own display data, honestly mirrored into `cascadeSignals` (no fudged
 * signals — all seven free fields were swept per fixture first; proven
 * by running `runCascade`, not by argument). Founder-directed
 * resolution — the engine is truth:
 *
 *   - Groupon (the guided demo's Archive anchor, `inbox-simulator-
 *     screen.tsx` step 1) KEEPS its Archive verdict, but the SIGNALS
 *     changed, not the verdict: the original 0%-read / zero-manual-
 *     archive-history signals could never reach Archive (they scored
 *     Unsubscribe, 0.92 — a one-click channel + real volume + near-zero
 *     read rate always outscores Archive at this cascade's current
 *     weights). The new story — reads ~30% of these and already
 *     archives the rest by hand — is both honest and cascade-verified;
 *     see the fixture's own comment below for the exact scores.
 *   - LinkedIn and Priya (the other two guided anchors) already matched
 *     honestly; untouched.
 *   - Old Navy, Nextdoor, Substack and Shipment Tracking take the
 *     engine's real output (Unsubscribe / Unsubscribe / Keep / Later
 *     respectively, replacing hand-written Archive / Archive / Later /
 *     Unsubscribe) — none of these anchor the guided demo, so there is
 *     no guided copy to keep in sync. django-users and Sarah already
 *     matched.
 *
 * Distribution: 4 Keep (2 protected + Substack + amazon-security) · 4
 * Archive (Groupon + the amazon.com run) · 5 Unsubscribe · 2 Later.
 *
 * Ordering is otherwise unchanged: "highest impact first" among the
 * original nine, then the amazon.com run appended. New rows are
 * APPENDED (not impact-sorted) because sibling tests pin rows by index
 * (`TRIAGE_QUEUE[0]`/`[1]` in action-sheet + screen-actions tests) and
 * `findDomainBatches` needs the six amazon.com seeds contiguous.
 * Fixtures are static so Storybook variants stay byte-stable.
 */
export const TRIAGE_FIXTURE_SEEDS: readonly TriageFixtureSeed[] = [
  // ── Groupon — the guided demo's Archive anchor (D133 RESOLVED
  // 2026-08-26). The original hand-written signals (0% read, no manual-
  // archive history) could never reach Archive under the real cascade —
  // see the resolved-question note above. Founder-directed fix: a
  // reader who opens some of these AND already archives the rest by
  // hand is a real, coherent Archive story the cascade actually backs.
  // `readRate` moved 0% → 30% (not frozen); `monthlyVolume`,
  // `last90dMessages`, `totalAllTime`, `unsubscribeMethod` untouched.
  {
    id: 't-groupon',
    senderId: 'sid-groupon',
    senderKey: 'sk_groupon',
    senderName: 'Groupon',
    senderEmail: 'noreply@groupon.com',
    senderDomain: 'groupon.com',
    brandMark: false,
    gmailCategory: 'promotions',
    unsubscribeMethod: 'one_click',
    signals: [
      'Read rate: 30% over the last 90 days',
      'Volume: 52 messages/month (4-week trailing average)',
      'You have manually archived messages from this sender before',
      'No reply from you to this sender in the last 12 months',
    ],
    protectionReason: null,
    monthlyVolume: 52,
    last90dMessages: 156,
    readRate: 0.3,
    lastDays: 0,
    totalAllTime: 1745,
    unreadInboxCount: 288,
    cascadeSignals: {
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'promotions',
      starredInLastYear: false,
      readRate90d: 0.3, // ← mirrors `readRate`; clears the < 0.2 / < 0.05
      // unsubscribe read-rate bonuses without tripping Phase A rule 5
      // (which needs >= 0.5)
      firstSeenMonthsAgo: 30,
      firstSeenDaysAgo: 900,
      lastSeenDaysAgo: 0, // ← mirrors `lastDays`
      totalMessages: 1745, // ← mirrors `totalAllTime`
      monthlyVolume: 52, // ← mirrors `monthlyVolume`
      // No spike claim (dropped from 3): a spike >= 3 pushes Unsubscribe's
      // score to 0.85 against Archive's 0.75, which wins even with the
      // manual-archive credit below. Verified against the real cascade,
      // not assumed — see the D133 task report.
      spikeRatio: 1,
      unsubscribeChannel: 'one_click', // ← mirrors `unsubscribeMethod`
      isGovDomain: false,
      // >= 3 is the threshold that matters (flat +0.3, not scaled); 12
      // is the number that makes "you already archive it yourself" true.
      userManuallyArchivedCount: 12,
    },
  },

  // ── LinkedIn — one-click Unsubscribe (D9 happy path) ─────────────
  {
    id: 't-linkedin',
    senderId: 'sid-linkedin',
    senderKey: 'sk_linkedin',
    senderName: 'LinkedIn',
    senderEmail: 'notifications-noreply@linkedin.com',
    senderDomain: 'linkedin.com',
    brandMark: false,
    gmailCategory: 'social',
    unsubscribeMethod: 'one_click',
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
    cascadeSignals: {
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'social',
      starredInLastYear: false,
      readRate90d: 0,
      firstSeenMonthsAgo: 12,
      firstSeenDaysAgo: 400,
      lastSeenDaysAgo: 0,
      totalMessages: 2432,
      monthlyVolume: 64,
      spikeRatio: 2,
      unsubscribeChannel: 'one_click',
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    },
  },

  // ── Old Navy — real signals score Unsubscribe, not the hand-written
  // Archive. Same shape as Groupon: see the D133 RESOLVED note above.
  {
    id: 't-oldnavy',
    senderId: 'sid-oldnavy',
    senderKey: 'sk_oldnavy',
    senderName: 'Old Navy',
    senderEmail: 'help@oldnavy.com',
    senderDomain: 'oldnavy.com',
    brandMark: false,
    gmailCategory: 'promotions',
    unsubscribeMethod: 'one_click',
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
    cascadeSignals: {
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'promotions',
      starredInLastYear: false,
      readRate90d: 0,
      firstSeenMonthsAgo: 20,
      firstSeenDaysAgo: 600,
      lastSeenDaysAgo: 0,
      totalMessages: 1056,
      monthlyVolume: 48,
      spikeRatio: 3,
      unsubscribeChannel: 'one_click',
      isGovDomain: false,
      userManuallyArchivedCount: 5,
    },
  },

  // ── django-users — mailto-only Unsubscribe (D230 deferred path) ──
  {
    id: 't-django',
    senderId: 'sid-django',
    senderKey: 'sk_django',
    senderName: 'django-users',
    senderEmail: 'django-users@googlegroups.com',
    senderDomain: 'googlegroups.com',
    brandMark: false,
    gmailCategory: 'forums',
    unsubscribeMethod: 'mailto',
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
    cascadeSignals: {
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'forums',
      starredInLastYear: false,
      readRate90d: 0.04,
      firstSeenMonthsAgo: 60,
      firstSeenDaysAgo: 2000,
      lastSeenDaysAgo: 0,
      totalMessages: 4692,
      monthlyVolume: 46,
      spikeRatio: 1,
      unsubscribeChannel: 'mailto',
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    },
  },

  // ── Nextdoor — real signals score Unsubscribe, not the hand-written
  // Archive. See the D133 RESOLVED note above.
  {
    id: 't-nextdoor',
    senderId: 'sid-nextdoor',
    senderKey: 'sk_nextdoor',
    senderName: 'Nextdoor',
    senderEmail: 'notifications@nextdoor.com',
    senderDomain: 'nextdoor.com',
    brandMark: false,
    gmailCategory: 'social',
    unsubscribeMethod: 'one_click',
    signals: ['Read rate: 30% over the last 90 days', 'Volume: 12 messages/month'],
    protectionReason: null,
    monthlyVolume: 12,
    last90dMessages: 36,
    readRate: 0.3,
    lastDays: 4,
    totalAllTime: 264,
    unreadInboxCount: 31,
    cascadeSignals: {
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'social',
      starredInLastYear: false,
      readRate90d: 0.3,
      // Kept under 60 so Phase A rule 6 ("long relationship, still
      // engaged") does not fire ahead of Phase C — see the D133 RESOLVED note above.
      firstSeenMonthsAgo: 20,
      firstSeenDaysAgo: 600,
      lastSeenDaysAgo: 4,
      totalMessages: 264,
      monthlyVolume: 12,
      spikeRatio: 1,
      unsubscribeChannel: 'one_click',
      isGovDomain: false,
      userManuallyArchivedCount: 5,
    },
  },

  // ── Letters of Note (Substack) — real signals score Keep, not the
  // hand-written Later. See the D133 RESOLVED note above: an 85% read rate
  // trips Phase A's `high_read_rate` rule unconditionally.
  {
    id: 't-substack',
    senderId: 'sid-substack',
    senderKey: 'sk_substack',
    senderName: 'Letters of Note',
    senderEmail: 'lon@substack.com',
    senderDomain: 'substack.com',
    brandMark: false,
    gmailCategory: 'promotions',
    unsubscribeMethod: 'one_click',
    signals: ['Read rate: 85% over the last 90 days', 'Volume: 8 messages/month'],
    protectionReason: null,
    monthlyVolume: 8,
    last90dMessages: 24,
    readRate: 0.85,
    lastDays: 3,
    totalAllTime: 96,
    unreadInboxCount: 1,
    cascadeSignals: {
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'promotions',
      starredInLastYear: false,
      readRate90d: 0.85,
      firstSeenMonthsAgo: 6,
      firstSeenDaysAgo: 200,
      lastSeenDaysAgo: 3,
      totalMessages: 96,
      monthlyVolume: 8,
      spikeRatio: 1,
      unsubscribeChannel: 'one_click',
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    },
  },

  // ── Keep · user-protected ────────────────────────────────────────
  {
    id: 't-sarah',
    senderId: 'sid-sarah',
    senderKey: 'sk_sarah',
    senderName: 'Sarah Chen',
    senderEmail: 'sarah.chen@google.com',
    senderDomain: 'google.com',
    brandMark: false,
    gmailCategory: 'primary',
    unsubscribeMethod: 'none',
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
    cascadeSignals: {
      isProtected: true,
      // Triage wire dialect ('manual') vs cascade/DB dialect
      // ('user_defined') — see the `ProtectionReason` comment above.
      protectionReason: 'user_defined',
      hasWrittenTo: true,
      gmailCategory: 'primary',
      starredInLastYear: false,
      readRate90d: 1,
      firstSeenMonthsAgo: 24,
      firstSeenDaysAgo: 700,
      lastSeenDaysAgo: 0,
      totalMessages: 306,
      monthlyVolume: 17,
      spikeRatio: 1,
      unsubscribeChannel: 'none',
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    },
  },

  // ── Keep · auto-protected (3+ replies, D245) ─────────────────────
  {
    id: 't-priya',
    senderId: 'sid-priya',
    senderKey: 'sk_priya',
    senderName: 'Priya Raman',
    senderEmail: 'priya@hey.com',
    senderDomain: 'hey.com',
    brandMark: false,
    gmailCategory: 'primary',
    unsubscribeMethod: 'none',
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
    cascadeSignals: {
      isProtected: true,
      protectionReason: 'replied',
      hasWrittenTo: true,
      gmailCategory: 'primary',
      starredInLastYear: false,
      readRate90d: 0.95,
      firstSeenMonthsAgo: 18,
      firstSeenDaysAgo: 550,
      lastSeenDaysAgo: 2,
      totalMessages: 84,
      monthlyVolume: 6,
      spikeRatio: 1,
      unsubscribeChannel: 'none',
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    },
  },

  // ── Shipment Tracking — real signals score Later, not the
  // hand-written Unsubscribe. See the D133 RESOLVED note above: Phase C's
  // unsubscribe score is gated behind a real channel, and this row's
  // whole reason for existing is `unsubscribeMethod: 'none'` (frozen).
  // Also quiet-90d (`last90dMessages: 0`) with a stale `lastDays: 0`,
  // the exact pair behind the 2026-07-02 "Quiet 90d · 555 received" vs
  // "LAST SEEN today" contradiction (still exercised — unrelated to
  // the verdict change above).
  // Appended last of the original nine so index-pinned tests
  // (TRIAGE_QUEUE[0]/[1]) hold.
  {
    id: 't-shipping',
    senderId: 'sid-shipping',
    senderKey: 'sk_shipping',
    senderName: 'Shipment Tracking',
    senderEmail: 'shipment-tracking@bigstore.example',
    senderDomain: 'bigstore.example',
    brandMark: false,
    gmailCategory: 'updates',
    unsubscribeMethod: 'none',
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
    cascadeSignals: {
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'updates',
      starredInLastYear: false,
      readRate90d: null, // ← mirrors `readRate` (unmeasurable, not 0)
      firstSeenMonthsAgo: 24,
      firstSeenDaysAgo: 800,
      lastSeenDaysAgo: 0,
      totalMessages: 555,
      monthlyVolume: 0,
      spikeRatio: 1,
      unsubscribeChannel: 'none', // ← mirrors `unsubscribeMethod`, FROZEN
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    },
  },

  // ══ amazon.com — six contiguous senders for Plan 4's domain-batch
  // card (D133). `findDomainBatches` needs ≥3 consecutive same-domain
  // rows with `protectionReason === null`; six with one Protected
  // leaves five eligible, well past the threshold. The five deliberately
  // carry THREE different verdicts (archive / unsubscribe / later) —
  // that mismatch is the point, not an oversight: it is what lets
  // Plan 4 show one composite decision covering senders the engine
  // itself disagrees about. Do not "tidy" the run into a single verdict.
  // All six use `gmailCategory: 'updates'` except Advertising
  // (Promotions) — realistic per-sender-address Gmail categorization,
  // and it happens to be what makes Advertising the Unsubscribe outlier
  // (see `cascade.ts`'s Phase C category boost).

  // ── Amazon.com — bulk of the volume; Archive ─────────────────────
  {
    id: 't-amazon-main',
    senderId: 'sid-amazon-main',
    senderKey: 'sk_amazon_main',
    senderName: 'Amazon.com',
    senderEmail: 'auto-confirm@amazon.com',
    senderDomain: 'amazon.com',
    brandMark: false,
    gmailCategory: 'updates',
    unsubscribeMethod: 'one_click',
    signals: [
      'Read rate: 35% over the last 90 days',
      'Volume: 62 messages/month (4-week trailing average)',
      'You have manually archived messages from this sender before',
    ],
    protectionReason: null,
    monthlyVolume: 62,
    last90dMessages: 186,
    readRate: 0.35,
    lastDays: 0,
    totalAllTime: 1800,
    unreadInboxCount: 120,
    cascadeSignals: {
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'updates',
      starredInLastYear: false,
      readRate90d: 0.35,
      firstSeenMonthsAgo: 40,
      firstSeenDaysAgo: 1200,
      lastSeenDaysAgo: 0,
      totalMessages: 1800,
      monthlyVolume: 62,
      spikeRatio: 1,
      unsubscribeChannel: 'one_click',
      isGovDomain: false,
      userManuallyArchivedCount: 4,
    },
  },

  // ── Amazon Prime Video — Archive ──────────────────────────────────
  {
    id: 't-amazon-primevideo',
    senderId: 'sid-amazon-primevideo',
    senderKey: 'sk_amazon_primevideo',
    senderName: 'Amazon Prime Video',
    senderEmail: 'primevideo@amazon.com',
    senderDomain: 'amazon.com',
    brandMark: false,
    gmailCategory: 'updates',
    unsubscribeMethod: 'one_click',
    signals: [
      'Read rate: 25% over the last 90 days',
      'Volume: 30 messages/month',
      'You have manually archived messages from this sender before',
    ],
    protectionReason: null,
    monthlyVolume: 30,
    last90dMessages: 90,
    readRate: 0.25,
    lastDays: 1,
    totalAllTime: 400,
    unreadInboxCount: 55,
    cascadeSignals: {
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'updates',
      starredInLastYear: false,
      readRate90d: 0.25,
      firstSeenMonthsAgo: 20,
      firstSeenDaysAgo: 700,
      lastSeenDaysAgo: 1,
      totalMessages: 400,
      monthlyVolume: 30,
      spikeRatio: 1,
      unsubscribeChannel: 'one_click',
      isGovDomain: false,
      userManuallyArchivedCount: 3,
    },
  },

  // ── Amazon Advertising — the disagreement: Unsubscribe ────────────
  // Promotions category (not Updates, like its five siblings) is what
  // tips this one into the unsubscribe-score category boost.
  {
    id: 't-amazon-advertising',
    senderId: 'sid-amazon-advertising',
    senderKey: 'sk_amazon_advertising',
    senderName: 'Amazon Advertising',
    senderEmail: 'advertising@amazon.com',
    senderDomain: 'amazon.com',
    brandMark: false,
    gmailCategory: 'promotions',
    unsubscribeMethod: 'one_click',
    signals: [
      'Read rate: 2% over the last 90 days',
      'Volume: 18 messages/month',
      "Volume spike: 3× the sender's usual cadence",
    ],
    protectionReason: null,
    monthlyVolume: 18,
    last90dMessages: 54,
    readRate: 0.02,
    lastDays: 0,
    totalAllTime: 90,
    unreadInboxCount: 53,
    cascadeSignals: {
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'promotions',
      starredInLastYear: false,
      readRate90d: 0.02,
      firstSeenMonthsAgo: 8,
      firstSeenDaysAgo: 250,
      lastSeenDaysAgo: 0,
      totalMessages: 90,
      monthlyVolume: 18,
      spikeRatio: 3,
      unsubscribeChannel: 'one_click',
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    },
  },

  // ── Amazon Orders — the second disagreement: Later ────────────────
  // A brand-new sender address (Amazon periodically splits notification
  // senders) — too new to judge, Phase B's `insufficient_signal` rule.
  {
    id: 't-amazon-orders',
    senderId: 'sid-amazon-orders',
    senderKey: 'sk_amazon_orders',
    senderName: 'Amazon Orders',
    senderEmail: 'order-update@amazon.com',
    senderDomain: 'amazon.com',
    brandMark: false,
    gmailCategory: 'updates',
    unsubscribeMethod: 'none',
    signals: ['First seen 4 days ago', 'Volume: 2 messages so far — not enough to judge yet'],
    protectionReason: null,
    monthlyVolume: 2,
    last90dMessages: 2,
    readRate: 0,
    lastDays: 0,
    totalAllTime: 2,
    unreadInboxCount: 2,
    cascadeSignals: {
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'updates',
      starredInLastYear: false,
      readRate90d: 0,
      firstSeenMonthsAgo: 0,
      firstSeenDaysAgo: 4, // < 7 — Phase B insufficient_signal
      lastSeenDaysAgo: 0,
      totalMessages: 2, // < 3 — Phase B insufficient_signal (either alone suffices)
      monthlyVolume: 2,
      spikeRatio: 1,
      unsubscribeChannel: 'none',
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    },
  },

  // ── Amazon Photos — Archive ────────────────────────────────────────
  {
    id: 't-amazon-photos',
    senderId: 'sid-amazon-photos',
    senderKey: 'sk_amazon_photos',
    senderName: 'Amazon Photos',
    senderEmail: 'photos@amazon.com',
    senderDomain: 'amazon.com',
    brandMark: false,
    gmailCategory: 'updates',
    unsubscribeMethod: 'one_click',
    signals: [
      'Read rate: 30% over the last 90 days',
      'Volume: 30 messages/month',
      'You have manually archived messages from this sender before',
    ],
    protectionReason: null,
    monthlyVolume: 30,
    last90dMessages: 90,
    readRate: 0.3,
    lastDays: 2,
    totalAllTime: 120,
    unreadInboxCount: 60,
    cascadeSignals: {
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'updates',
      starredInLastYear: false,
      readRate90d: 0.3,
      firstSeenMonthsAgo: 15,
      firstSeenDaysAgo: 500,
      lastSeenDaysAgo: 2,
      totalMessages: 120,
      monthlyVolume: 30,
      spikeRatio: 1,
      unsubscribeChannel: 'one_click',
      isGovDomain: false,
      userManuallyArchivedCount: 3,
    },
  },

  // ── Amazon Account Security — the skipped one: Keep (Protected) ───
  // Gmail-important-derived protection — an honest reason for a
  // security-notification sender, and a different D245 protect rule
  // than t-priya's replied-derived one.
  {
    id: 't-amazon-security',
    senderId: 'sid-amazon-security',
    senderKey: 'sk_amazon_security',
    senderName: 'Amazon Account Security',
    senderEmail: 'account-security@amazon.com',
    senderDomain: 'amazon.com',
    brandMark: false,
    gmailCategory: 'updates',
    unsubscribeMethod: 'none',
    signals: [
      "Protected — Gmail marked several of this sender's messages important this year",
      'Read rate: 90% over the last 90 days',
      'Volume: 1 message/month',
    ],
    protectionReason: 'gmail-important',
    monthlyVolume: 1,
    last90dMessages: 3,
    readRate: 0.9,
    lastDays: 10,
    totalAllTime: 40,
    unreadInboxCount: 2,
    cascadeSignals: {
      isProtected: true,
      protectionReason: 'gmail_important',
      hasWrittenTo: false,
      gmailCategory: 'updates',
      starredInLastYear: false,
      readRate90d: 0.9,
      firstSeenMonthsAgo: 40,
      firstSeenDaysAgo: 1200,
      lastSeenDaysAgo: 10,
      totalMessages: 40,
      monthlyVolume: 1,
      spikeRatio: 1,
      unsubscribeChannel: 'none',
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    },
  },
];

/** Every consumer's type is unchanged — this is still
 *  `readonly TriageDecisionRow[]`, just derived instead of hand-written. */
export const TRIAGE_QUEUE: readonly TriageDecisionRow[] = TRIAGE_FIXTURE_SEEDS.map(buildFixtureRow);

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
 * any `lastDays < 90` is internally inconsistent — the aggregate window is
 * computed in SQL from real rows. The window wins: render "90d+" unless
 * `lastDays` already agrees.
 *
 * The back end no longer collapses an unreadable date to `0` (it sends `null`),
 * so this is now a consistency guard rather than the mitigation it started as.
 * It was never sufficient on its own: gated on an EMPTY 90-day window, it only
 * ever covered senders where a "today" would have looked absurd, and left the
 * 1-89 day band — where a wrong "today" reads as entirely plausible — rendering
 * the false value. 849 of the 954 rows that asserted a recency were wrong.
 */
export function lastSeenLabel(
  row: Pick<TriageDecisionRow, 'lastDays' | 'last90dMessages'>,
): string {
  // Unknown renders as unknown — the word, not a glyph the reader has to
  // infer. Anything else here invents a recency for mail whose date we could
  // not read.
  if (row.lastDays === null) return 'unknown';
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
