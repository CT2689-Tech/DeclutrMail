import { describe, expect, it } from 'vitest';

import {
  GOV_UNSUB_CONFIDENCE_CAP,
  isGovernmentDomain,
  runCascade,
  type SenderSignals,
} from './score-cascade.js';

/**
 * Cascade unit tests (D20, D21).
 *
 * Pure-function tests — no DB, no LLM. Each test pins ONE cascade rule
 * to its expected verdict + confidence. The cascade ordering rules in
 * D21 are tested by deliberately constructing signals that would match
 * MULTIPLE rules — the earlier rule must win.
 *
 * D227: every verdict tested is one of K/A/U/L. No `'screen'` ever
 * appears here — the internal enum already uses `'later'`.
 *
 * D222: tests cover signals like `gmailCategory` (Gmail's own label,
 * not predicted). No test asserts a category prediction — the cascade
 * doesn't have one. `unsubscribeChannel` / `isGovDomain` are rule-matched
 * facts (sender-declared headers; public-suffix string check), never
 * predicted or persisted categories.
 */

/** Base signals — neutral inputs that fall through to Phase C scoring. */
function baseSignals(): SenderSignals {
  return {
    isProtected: false,
    hasReplied: false,
    gmailCategory: 'promotions',
    starredInLastYear: false,
    readRate90d: 0.1,
    firstSeenMonthsAgo: 12,
    firstSeenDaysAgo: 365,
    lastSeenDaysAgo: 1,
    totalMessages: 50,
    monthlyVolume: 10,
    spikeRatio: 1,
    unsubscribeChannel: 'none',
    isGovDomain: false,
    userManuallyArchivedCount: 0,
  };
}

describe('runCascade — Phase A (protection / engagement)', () => {
  it('protected sender → keep at 1.0, regardless of other signals', () => {
    const result = runCascade({
      ...baseSignals(),
      isProtected: true,
      protectionReason: 'user_defined',
      // These would otherwise trigger Phase C unsubscribe:
      readRate90d: 0,
      monthlyVolume: 100,
      gmailCategory: 'promotions',
      unsubscribeChannel: 'one_click',
    });
    expect(result.verdict).toBe('keep');
    expect(result.confidence).toBe(1.0);
    expect(result.phase).toBe('A');
    expect(result.ruleId).toBe('protect_user_defined');
  });

  it('engagement-protected sender → keep with engagement provenance', () => {
    const result = runCascade({
      ...baseSignals(),
      isProtected: true,
      protectionReason: 'engagement_based',
    });
    expect(result.ruleId).toBe('protect_engagement_based');
    expect(result.verdict).toBe('keep');
  });

  it('replied at least once → keep at 0.98, even with low read rate', () => {
    const result = runCascade({
      ...baseSignals(),
      hasReplied: true,
      readRate90d: 0.01,
    });
    expect(result.verdict).toBe('keep');
    expect(result.confidence).toBe(0.98);
    expect(result.ruleId).toBe('replied_at_least_once');
  });

  it('Gmail Primary category → keep at 0.95 (when not replied)', () => {
    const result = runCascade({
      ...baseSignals(),
      gmailCategory: 'primary',
    });
    expect(result.verdict).toBe('keep');
    expect(result.confidence).toBe(0.95);
    expect(result.ruleId).toBe('gmail_primary');
  });

  it('starred in last year → keep at 0.92 (when not Primary)', () => {
    const result = runCascade({
      ...baseSignals(),
      starredInLastYear: true,
    });
    expect(result.verdict).toBe('keep');
    expect(result.confidence).toBe(0.92);
    expect(result.ruleId).toBe('starred_recently');
  });

  it('read_rate ≥ 50% → keep at 0.85 (engaged reader)', () => {
    const result = runCascade({
      ...baseSignals(),
      readRate90d: 0.55,
    });
    expect(result.verdict).toBe('keep');
    expect(result.confidence).toBe(0.85);
    expect(result.ruleId).toBe('high_read_rate');
  });

  it('long relationship still engaged → keep at 0.80', () => {
    const result = runCascade({
      ...baseSignals(),
      firstSeenMonthsAgo: 72,
      readRate90d: 0.35,
    });
    expect(result.verdict).toBe('keep');
    expect(result.confidence).toBe(0.8);
    expect(result.ruleId).toBe('long_relationship_engaged');
  });
});

describe('runCascade — Phase A cascade ordering (earlier rules win)', () => {
  it('protect wins over replied — even if replied=true', () => {
    const result = runCascade({
      ...baseSignals(),
      isProtected: true,
      protectionReason: 'user_defined',
      hasReplied: true,
      gmailCategory: 'primary',
      starredInLastYear: true,
    });
    expect(result.ruleId).toBe('protect_user_defined');
    expect(result.confidence).toBe(1.0);
  });

  it('replied wins over gmail_primary', () => {
    const result = runCascade({
      ...baseSignals(),
      hasReplied: true,
      gmailCategory: 'primary',
    });
    expect(result.ruleId).toBe('replied_at_least_once');
    expect(result.confidence).toBe(0.98);
  });

  it('gmail_primary wins over starred', () => {
    const result = runCascade({
      ...baseSignals(),
      gmailCategory: 'primary',
      starredInLastYear: true,
    });
    expect(result.ruleId).toBe('gmail_primary');
    expect(result.confidence).toBe(0.95);
  });

  it('starred wins over high_read_rate', () => {
    const result = runCascade({
      ...baseSignals(),
      starredInLastYear: true,
      readRate90d: 0.8,
    });
    expect(result.ruleId).toBe('starred_recently');
    expect(result.confidence).toBe(0.92);
  });

  it('high_read_rate wins over long_relationship_engaged', () => {
    const result = runCascade({
      ...baseSignals(),
      readRate90d: 0.6,
      firstSeenMonthsAgo: 72,
    });
    expect(result.ruleId).toBe('high_read_rate');
    expect(result.confidence).toBe(0.85);
  });
});

describe('runCascade — Phase B (insufficient signal)', () => {
  it('fewer than 3 total messages → later at 0.70', () => {
    const result = runCascade({
      ...baseSignals(),
      totalMessages: 2,
    });
    expect(result.verdict).toBe('later');
    expect(result.confidence).toBe(0.7);
    expect(result.phase).toBe('B');
    expect(result.ruleId).toBe('insufficient_signal');
  });

  it('first seen fewer than 7 days ago → later at 0.70', () => {
    const result = runCascade({
      ...baseSignals(),
      firstSeenDaysAgo: 3,
    });
    expect(result.verdict).toBe('later');
    expect(result.ruleId).toBe('insufficient_signal');
  });

  it('Phase B does NOT use "screen" — user-facing verb is "later"', () => {
    const result = runCascade({
      ...baseSignals(),
      totalMessages: 1,
    });
    // D227 — the verdict enum stores user-facing values directly.
    expect(result.verdict).toBe('later');
    expect((result.verdict as string) !== 'screen').toBe(true);
  });
});

describe('runCascade — Phase C (Archive vs Unsubscribe scoring)', () => {
  it('high volume + manual archives → archive winner', () => {
    const result = runCascade({
      ...baseSignals(),
      monthlyVolume: 65,
      userManuallyArchivedCount: 4,
      // Keep unsubscribe pieces lower
      readRate90d: 0.3,
      gmailCategory: 'updates',
    });
    expect(result.verdict).toBe('archive');
    expect(result.phase).toBe('C');
    expect(result.ruleId).toBe('score_archive');
    // Confidence is clamped to [0.55, 0.95].
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
    expect(result.confidence).toBeLessThanOrEqual(0.95);
    expect(result.scores).toBeDefined();
    expect(result.scores!.archive).toBeGreaterThan(result.scores!.unsubscribe);
  });

  it('zero read rate + promotions + one-click channel + volume → unsubscribe winner', () => {
    const result = runCascade({
      ...baseSignals(),
      readRate90d: 0.0,
      gmailCategory: 'promotions',
      unsubscribeChannel: 'one_click',
      monthlyVolume: 40,
      lastSeenDaysAgo: 5,
    });
    expect(result.verdict).toBe('unsubscribe');
    expect(result.ruleId).toBe('score_unsubscribe');
    // one_click 0.35 + vol≥8 0.15 + vol≥30 0.15 + read<0.20 0.15 +
    // read<0.05 0.10 + promotions 0.10 = 1.00 vs archive 0.45.
    expect(result.scores!.unsubscribe).toBe(1.0);
    expect(result.scores!.unsubscribe).toBeGreaterThan(result.scores!.archive);
  });

  it('tie-break — equal scores fall to archive (less destructive)', () => {
    // Engineered pure tie:
    // archive: vol≥30 (+0.30) + vol≥60 (+0.20) + channel (+0.15) = 0.65
    // unsub:   one_click (+0.35) + vol≥8 (+0.15) + vol≥30 (+0.15) = 0.65
    // (read 0.25 → no disengagement bumps; updates → no category bump.)
    const tie = runCascade({
      ...baseSignals(),
      monthlyVolume: 60,
      unsubscribeChannel: 'one_click',
      readRate90d: 0.25,
      gmailCategory: 'updates',
      lastSeenDaysAgo: 5,
      spikeRatio: 1,
      userManuallyArchivedCount: 0,
    });
    expect(tie.scores!.archive).toBe(0.65);
    expect(tie.scores!.unsubscribe).toBe(0.65);
    expect(tie.verdict).toBe('archive');
    expect(tie.ruleId).toBe('score_archive');
  });

  it('both scores below 0.50 → later (inconclusive)', () => {
    // A channel + stream volume EXISTS (gate passes) but neither side
    // clears 0.50 → the "signals are mixed" fallback, not the gated rule.
    const result = runCascade({
      ...baseSignals(),
      monthlyVolume: 5,
      readRate90d: 0.3,
      gmailCategory: 'updates',
      lastSeenDaysAgo: 5,
      spikeRatio: 1,
      unsubscribeChannel: 'mailto',
      userManuallyArchivedCount: 0,
    });
    expect(result.verdict).toBe('later');
    expect(result.confidence).toBe(0.6);
    expect(result.phase).toBe('C');
    expect(result.ruleId).toBe('score_inconclusive');
    expect(result.scores!.archive).toBeLessThan(0.5);
    expect(result.scores!.unsubscribe).toBeLessThan(0.5);
  });

  it('confidence is clamped to [0.55, 0.95]', () => {
    // Max archive (0.95) vs a real unsubscribe loser (0.65) → strength +
    // margin land at 0.86, inside the band.
    const result = runCascade({
      ...baseSignals(),
      monthlyVolume: 65, // archive +0.50
      userManuallyArchivedCount: 3, // archive +0.30 → 0.80
      unsubscribeChannel: 'one_click', // archive +0.15 → 0.95
      readRate90d: 0.3, // no disengagement bumps
      gmailCategory: 'updates',
      lastSeenDaysAgo: 5,
      spikeRatio: 1,
    });
    expect(result.verdict).toBe('archive');
    expect(result.confidence).toBeLessThanOrEqual(0.95);
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
  });
});

describe('runCascade — D29 unsubscribe over-recommendation regression (2026-07-02 live queue)', () => {
  // Four personas mirroring the founder's real triage queue the day the
  // bug was verified: EVERY quiet sender — the DMV, American Express
  // Travel, a mutual fund registrar, exchange support — surfaced as
  // "Unsubscribe · 95%" because inactivity alone carried the score and
  // `winner/(winner+loser)` degenerated to 1.0 when archive was 0.

  /** donotreply@dmv.ca.gov — 8 lifetime messages, no List-Unsubscribe. */
  function govNoReply(): SenderSignals {
    return {
      ...baseSignals(),
      gmailCategory: 'updates',
      readRate90d: 0,
      monthlyVolume: 0.33,
      totalMessages: 8,
      lastSeenDaysAgo: 60,
      unsubscribeChannel: 'none',
      isGovDomain: true, // dmv.ca.gov
    };
  }

  /** AmEx-Travel-style transactional: quiet, named sender, no unsub header. */
  function quietTransactional(): SenderSignals {
    return {
      ...baseSignals(),
      gmailCategory: 'updates',
      readRate90d: 0.02,
      monthlyVolume: 1,
      totalMessages: 20,
      lastSeenDaysAgo: 45,
      unsubscribeChannel: 'none',
    };
  }

  /** A genuine newsletter: 40/mo, one-click channel, 2% read rate. */
  function genuineNewsletter(): SenderSignals {
    return {
      ...baseSignals(),
      gmailCategory: 'promotions',
      readRate90d: 0.02,
      monthlyVolume: 40,
      lastSeenDaysAgo: 2,
      unsubscribeChannel: 'one_click',
    };
  }

  /** Mailto-only channel at mid volume: unsubscribable, but manual (D230). */
  function mailtoMidVolume(): SenderSignals {
    return {
      ...baseSignals(),
      gmailCategory: 'updates',
      readRate90d: 0.03,
      monthlyVolume: 10,
      unsubscribeChannel: 'mailto',
    };
  }

  it('gov no-reply with 8 lifetime messages → Later, never Unsubscribe (was Unsubscribe · 95%)', () => {
    const result = runCascade(govNoReply());
    expect(result.verdict).toBe('later');
    expect(result.ruleId).toBe('score_no_unsub_channel');
    expect(result.confidence).toBe(0.6);
    // The gate zeroes the score entirely — inactivity is not evidence.
    expect(result.scores!.unsubscribe).toBe(0);
  });

  it('quiet transactional sender without an unsubscribe channel → Later (was Unsubscribe · 95%)', () => {
    const result = runCascade(quietTransactional());
    expect(result.verdict).toBe('later');
    expect(result.ruleId).toBe('score_no_unsub_channel');
    expect(result.confidence).toBe(0.6);
    expect(result.scores!.unsubscribe).toBe(0);
  });

  it('genuine newsletter (one-click + volume + unread) → still high-confidence Unsubscribe', () => {
    const result = runCascade(genuineNewsletter());
    expect(result.verdict).toBe('unsubscribe');
    expect(result.ruleId).toBe('score_unsubscribe');
    expect(result.confidence).toBe(0.91);
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('mailto-only mid-volume → Unsubscribe at moderate confidence (manual channel, weaker)', () => {
    const result = runCascade(mailtoMidVolume());
    expect(result.verdict).toBe('unsubscribe');
    expect(result.confidence).toBe(0.76);
  });

  it('confidence VALUES differentiate across the four personas (no more everything-at-95)', () => {
    const gov = runCascade(govNoReply()).confidence;
    const transactional = runCascade(quietTransactional()).confidence;
    const newsletter = runCascade(genuineNewsletter()).confidence;
    const mailto = runCascade(mailtoMidVolume()).confidence;

    // Strict ordering: strong channel + volume > manual channel > gated.
    expect(newsletter).toBeGreaterThan(mailto);
    expect(mailto).toBeGreaterThan(gov);
    expect(gov).toBe(transactional); // both honestly "decide later"
    // Real spread, and none of them pinned at the 0.95 ceiling.
    expect(new Set([gov, transactional, newsletter, mailto]).size).toBeGreaterThanOrEqual(3);
    for (const c of [gov, transactional, newsletter, mailto]) {
      expect(c).toBeLessThan(0.95);
    }
  });

  it('inactivity alone (stale + zero reads, active-volume, NO channel) can never yield Unsubscribe', () => {
    const result = runCascade({
      ...baseSignals(),
      readRate90d: 0,
      lastSeenDaysAgo: 200,
      monthlyVolume: 10, // stream-sized volume, but nothing to unsubscribe from
      unsubscribeChannel: 'none',
      gmailCategory: 'updates',
    });
    expect(result.verdict).not.toBe('unsubscribe');
    expect(result.ruleId).toBe('score_no_unsub_channel');
    expect(result.scores!.unsubscribe).toBe(0);
  });

  it('a channel WITHOUT stream volume is gated too (one-click, 1/mo)', () => {
    const result = runCascade({
      ...baseSignals(),
      readRate90d: 0,
      monthlyVolume: 1,
      unsubscribeChannel: 'one_click',
      gmailCategory: 'updates',
    });
    expect(result.verdict).toBe('later');
    expect(result.ruleId).toBe('score_quiet_stream');
    expect(result.scores!.unsubscribe).toBe(0);
  });

  it('gov sender WITH a real one-click stream may get Unsubscribe, capped at 0.75', () => {
    const govNewsletter: SenderSignals = {
      ...baseSignals(),
      gmailCategory: 'updates',
      readRate90d: 0,
      monthlyVolume: 40,
      unsubscribeChannel: 'one_click',
      isGovDomain: true,
    };
    const capped = runCascade(govNewsletter);
    expect(capped.verdict).toBe('unsubscribe');
    expect(capped.confidence).toBe(GOV_UNSUB_CONFIDENCE_CAP);
    // The cap actually engaged: the identical non-gov sender scores higher.
    const uncapped = runCascade({ ...govNewsletter, isGovDomain: false });
    expect(uncapped.confidence).toBeGreaterThan(GOV_UNSUB_CONFIDENCE_CAP);
  });

  it('gov cap applies to Unsubscribe only — archive verdicts are not capped', () => {
    const result = runCascade({
      ...baseSignals(),
      monthlyVolume: 65,
      userManuallyArchivedCount: 4,
      readRate90d: 0.3,
      gmailCategory: 'updates',
      unsubscribeChannel: 'one_click',
      isGovDomain: true,
    });
    expect(result.verdict).toBe('archive');
    expect(result.confidence).toBeGreaterThan(GOV_UNSUB_CONFIDENCE_CAP);
  });

  it('max-signal unsubscribe stays below the 0.95 ceiling', () => {
    const result = runCascade({
      ...baseSignals(),
      gmailCategory: 'promotions',
      readRate90d: 0,
      monthlyVolume: 100,
      spikeRatio: 5,
      unsubscribeChannel: 'one_click',
    });
    expect(result.verdict).toBe('unsubscribe');
    expect(result.confidence).toBeLessThan(0.95);
  });
});

describe('isGovernmentDomain — deterministic public-suffix rule (D222-safe)', () => {
  it.each(['dmv.ca.gov', 'irs.gov', 'army.mil', 'tin.gov.in', 'gov.uk', 'ssa.GOV'])(
    'matches %s',
    (domain) => {
      expect(isGovernmentDomain(domain)).toBe(true);
    },
  );

  it.each(['americanexpress.com', 'mailchimp.com', 'milkbar.com', 'gove.co', 'flexport.com', ''])(
    'does not match %s',
    (domain) => {
      expect(isGovernmentDomain(domain)).toBe(false);
    },
  );
});
