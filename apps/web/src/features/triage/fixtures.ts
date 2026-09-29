/**
 * Triage fixtures — the demo queue and session snapshots (D133).
 *
 * The rows are derived by the real engine (`runCascade` +
 * `renderTemplate`), so the public demo cannot drift from what the
 * product would recommend. They live apart from `data.ts` because every
 * route that imports a row helper from there would otherwise ship the
 * engine and these fixture senders on first load; only Storybook, the
 * tests and the marketing inbox simulator import this file.
 *
 * Fixtures are static so Storybook variants stay byte-stable.
 */

import { renderTemplate, runCascade, type SenderSignals } from '@declutrmail/shared/triage-engine';

import type {
  TriageDecisionRow,
  TriageScreenState,
  TriageSessionStats,
  UnsubscribeMethod,
} from './data';

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
/**
 * Fixture dates as an ISO instant N calendar days back from midnight today.
 *
 * Anchored to LOCAL midnight, not `Date.now() - n * 86400000`. The rendered
 * label is a calendar-day difference, so a fixture built from elapsed
 * milliseconds lands on the previous day whenever the suite runs before that
 * many hours past midnight — a story that reads "2d" in the morning and "3d"
 * at night.
 */
function fixtureDaysAgo(days: number): string {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  midnight.setDate(midnight.getDate() - days);
  // Mid-morning, so the instant is unambiguously inside that calendar day in
  // any timezone the value is later read back in.
  midnight.setHours(9, 0, 0, 0);
  return midnight.toISOString();
}

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
      'Marked read: 30% over the last 90 days',
      'Volume: 52 emails/month (90-day average)',
      'You have manually archived messages from this sender before',
      'No reply from you to this sender in the last 12 months',
    ],
    protectionReason: null,
    monthlyVolume: 52,
    last90dMessages: 156,
    readRate: 0.3,
    lastSeenAt: fixtureDaysAgo(0),
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
      'Marked read: 0% over the last 90 days',
      'Volume: 64 emails/month (90-day average)',
      "Volume spike: 2× the sender's usual cadence",
      // Locked-copy ban per spec v1.2 Decision 15: jargon-free phrasing.
      'One-click unsubscribe available',
    ],
    protectionReason: null,
    monthlyVolume: 64,
    last90dMessages: 192,
    readRate: 0,
    lastSeenAt: fixtureDaysAgo(0),
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
      'Marked read: 0% over the last 90 days',
      'Volume: 48 emails/month (90-day average)',
      "Volume spike: 3× the sender's usual cadence",
    ],
    protectionReason: null,
    monthlyVolume: 48,
    last90dMessages: 144,
    readRate: 0,
    lastSeenAt: fixtureDaysAgo(0),
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
      'Marked read: 4% over the last 90 days',
      'Volume: 46 emails/month (90-day average)',
      // Locked-copy ban per spec v1.2 Decision 15: jargon-free phrasing.
      'Unsubscribe is by reply only (no one-click option)',
      'No reply from you to this thread in the last 6 months',
    ],
    protectionReason: null,
    monthlyVolume: 46,
    last90dMessages: 138,
    readRate: 0.04,
    lastSeenAt: fixtureDaysAgo(0),
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
    signals: ['Marked read: 30% over the last 90 days', 'Volume: 12 emails/month (90-day average)'],
    protectionReason: null,
    monthlyVolume: 12,
    last90dMessages: 36,
    readRate: 0.3,
    lastSeenAt: fixtureDaysAgo(4),
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
    signals: ['Marked read: 85% over the last 90 days', 'Volume: 8 emails/month (90-day average)'],
    protectionReason: null,
    monthlyVolume: 8,
    last90dMessages: 24,
    readRate: 0.85,
    lastSeenAt: fixtureDaysAgo(3),
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
      'Marked read: 100% over the last 90 days',
      'Volume: 17 emails/month (90-day average)',
    ],
    protectionReason: 'manual',
    monthlyVolume: 17,
    last90dMessages: 51,
    readRate: 1,
    lastSeenAt: fixtureDaysAgo(0),
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
      'Marked read: 95% over the last 90 days',
      'Volume: 6 emails/month (90-day average)',
      'Protected — automatic and bulk cleanup stays off because you wrote to them at least 3 times',
    ],
    protectionReason: 'replied',
    monthlyVolume: 6,
    last90dMessages: 18,
    readRate: 0.95,
    lastSeenAt: fixtureDaysAgo(2),
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
      'Marked read: 0% over the last 90 days',
      'Quiet: no messages in the last 90 days',
      'No unsubscribe channel advertised by this sender',
    ],
    protectionReason: null,
    monthlyVolume: 0,
    last90dMessages: 0,
    // Quiet within the window — the BE sends null, not 0.
    readRate: null,
    lastSeenAt: fixtureDaysAgo(0),
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
  // rows with a confident cleanup recommendation; six with one Protected
  // and one low-signal Later leaves four eligible, past the threshold.
  // The five unprotected senders deliberately
  // carry THREE different verdicts (archive / unsubscribe / later) —
  // that mismatch is the point, not an oversight: it is what lets
  // Plan 4 show one composite decision for the confident cleanup senders
  // while leaving the low-signal sender for individual review.
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
      'Marked read: 35% over the last 90 days',
      'Volume: 62 emails/month (90-day average)',
      'You have manually archived messages from this sender before',
    ],
    protectionReason: null,
    monthlyVolume: 62,
    last90dMessages: 186,
    readRate: 0.35,
    lastSeenAt: fixtureDaysAgo(0),
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
      'Marked read: 25% over the last 90 days',
      'Volume: 30 emails/month (90-day average)',
      'You have manually archived messages from this sender before',
    ],
    protectionReason: null,
    monthlyVolume: 30,
    last90dMessages: 90,
    readRate: 0.25,
    lastSeenAt: fixtureDaysAgo(1),
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
      'Marked read: 2% over the last 90 days',
      'Volume: 18 emails/month (90-day average)',
      "Volume spike: 3× the sender's usual cadence",
    ],
    protectionReason: null,
    monthlyVolume: 18,
    last90dMessages: 54,
    readRate: 0.02,
    lastSeenAt: fixtureDaysAgo(0),
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
    lastSeenAt: fixtureDaysAgo(0),
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
      'Marked read: 30% over the last 90 days',
      'Volume: 30 emails/month (90-day average)',
      'You have manually archived messages from this sender before',
    ],
    protectionReason: null,
    monthlyVolume: 30,
    last90dMessages: 90,
    readRate: 0.3,
    lastSeenAt: fixtureDaysAgo(2),
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
      'Marked read: 90% over the last 90 days',
      'Volume: 1 message/month',
    ],
    protectionReason: 'gmail-important',
    monthlyVolume: 1,
    last90dMessages: 3,
    readRate: 0.9,
    lastSeenAt: fixtureDaysAgo(10),
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

/**
 * Default screen state — fixtures, for Storybook variants and the
 * SSR-shape tests. The live routes compose the real state from the
 * triage queries (see `compose-state.ts`) and always pass it.
 */
export const DEFAULT_TRIAGE_STATE: TriageScreenState = {
  kind: 'ready',
  rows: [...TRIAGE_QUEUE],
  stats: TRIAGE_SESSION_STATS,
};
