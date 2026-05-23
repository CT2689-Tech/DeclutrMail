import { describe, expect, it } from 'vitest';

import { runCascade, type SenderSignals } from './score-cascade.js';

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
 * doesn't have one.
 */

/** Base signals — neutral inputs that fall through to Phase C scoring. */
function baseSignals(): SenderSignals {
  return {
    isProtected: false,
    isVip: false,
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
    hasUnsubscribeHeader: false,
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
      hasUnsubscribeHeader: true,
    });
    expect(result.verdict).toBe('keep');
    expect(result.confidence).toBe(1.0);
    expect(result.phase).toBe('A');
    expect(result.ruleId).toBe('protect_user_defined');
  });

  it('protected VIP → keep at 1.0, ruleId reflects VIP provenance', () => {
    const result = runCascade({
      ...baseSignals(),
      isProtected: true,
      protectionReason: 'vip',
      isVip: true,
    });
    expect(result.ruleId).toBe('protect_vip');
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

  it('zero read rate + promotions + unsub header → unsubscribe winner', () => {
    const result = runCascade({
      ...baseSignals(),
      readRate90d: 0.0,
      gmailCategory: 'promotions',
      hasUnsubscribeHeader: true,
      monthlyVolume: 40,
      lastSeenDaysAgo: 5,
    });
    expect(result.verdict).toBe('unsubscribe');
    expect(result.ruleId).toBe('score_unsubscribe');
    expect(result.scores!.unsubscribe).toBeGreaterThan(result.scores!.archive);
  });

  it('tie-break — equal scores fall to archive (less destructive)', () => {
    // Equal sums (each weight is balanced) → tie-break wins archive.
    // archive = 0.30 (vol≥30) + 0.15 (unsub header) = 0.45 — under 0.50
    // unsubscribe = 0.30 (read<0.20) + 0.20 (unsub header) = 0.50 — at 0.50
    // To force a tie above 0.50 in both, push both up. Easier: contrive
    // direct equality with two specific signals.
    const result = runCascade({
      ...baseSignals(),
      monthlyVolume: 65, // archive +0.30 +0.20 = 0.50
      userManuallyArchivedCount: 0,
      hasUnsubscribeHeader: false,
      readRate90d: 0.0, // unsub +0.40 +0.30 = 0.70 ... unequal.
      // Try alternative: archive 0.50, unsub 0.50.
      // Real-world ties are vanishingly rare; this test pins the
      // deterministic tie-break with two engineered inputs:
      gmailCategory: 'updates', // no Promotions/Forums/Social bump
      lastSeenDaysAgo: 0,
      spikeRatio: 0,
    });
    // Either result is fine for this assertion — we just verify the
    // tie-break tag (`>=` in the comparator) holds. With these inputs:
    //   archive = 0.50, unsub = 0.70 → score_unsubscribe.
    // The point of the test is the COMPARATOR. Re-engineer for a true tie:
    const tiedResult = runCascade({
      ...baseSignals(),
      monthlyVolume: 30, // archive +0.30 = 0.30
      userManuallyArchivedCount: 3, // archive +0.30 = 0.60
      hasUnsubscribeHeader: false,
      readRate90d: 0.3, // unsub +0 (not <0.05 and not <0.20)
      lastSeenDaysAgo: 30, // unsub +0.10
      spikeRatio: 3, // unsub +0.30
      gmailCategory: 'updates',
      // unsub = 0.40 ... unequal. Final attempt with explicit numbers:
    });
    void result;
    void tiedResult;
    // Construct a pure tie by picking offsetting independent weights.
    // archive: vol≥30 (+0.30) + manual≥3 (+0.30) = 0.60
    // unsub:   read<0.20 (+0.30) + spike≥3 (+0.30) = 0.60
    const tie = runCascade({
      ...baseSignals(),
      monthlyVolume: 30,
      userManuallyArchivedCount: 3,
      readRate90d: 0.15,
      spikeRatio: 3,
      hasUnsubscribeHeader: false,
      lastSeenDaysAgo: 5,
      gmailCategory: 'updates',
    });
    expect(tie.scores!.archive).toBe(0.6);
    expect(tie.scores!.unsubscribe).toBe(0.6);
    expect(tie.verdict).toBe('archive');
    expect(tie.ruleId).toBe('score_archive');
  });

  it('both scores below 0.50 → later (inconclusive)', () => {
    const result = runCascade({
      ...baseSignals(),
      monthlyVolume: 5,
      readRate90d: 0.3,
      gmailCategory: 'updates',
      lastSeenDaysAgo: 5,
      spikeRatio: 1,
      hasUnsubscribeHeader: false,
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
    // Engineer winner = 1.0, loser = 0.0 → raw confidence 1.0; clamp to 0.95.
    const result = runCascade({
      ...baseSignals(),
      monthlyVolume: 65, // archive +0.50
      userManuallyArchivedCount: 3, // archive +0.30 → 0.80
      hasUnsubscribeHeader: true, // archive +0.15 → 0.95
      readRate90d: 0.3, // no unsub bumps
      gmailCategory: 'updates',
      lastSeenDaysAgo: 5,
      spikeRatio: 1,
    });
    expect(result.confidence).toBeLessThanOrEqual(0.95);
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
  });
});
