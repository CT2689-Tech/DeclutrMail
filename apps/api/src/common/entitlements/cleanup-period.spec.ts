import { describe, expect, it } from 'vitest';

import { cleanupPeriodFor } from './cleanup-period.js';

/**
 * A3 anniversary boundary tests. Every computation is from the ORIGINAL
 * anchor, in UTC, with month clamping — the required cases from the
 * launch-completion brief: created Jan 31, created Feb 29 (leap),
 * immediately before reset, the exact reset instant, and immediately
 * after.
 */
describe('cleanupPeriodFor', () => {
  const at = (iso: string) => new Date(iso);

  it('clamps a Jan 31 anchor to Feb 28 and self-heals back to Mar 31', () => {
    const anchor = at('2026-01-31T12:00:00.000Z');

    const feb = cleanupPeriodFor(anchor, at('2026-02-10T00:00:00.000Z'));
    expect(feb.periodStart.toISOString()).toBe('2026-01-31T12:00:00.000Z');
    expect(feb.resetsAt.toISOString()).toBe('2026-02-28T12:00:00.000Z');

    const mar = cleanupPeriodFor(anchor, at('2026-03-10T00:00:00.000Z'));
    expect(mar.periodStart.toISOString()).toBe('2026-02-28T12:00:00.000Z');
    // Self-healing: back on the 31st, not drifting to the 28th forever.
    expect(mar.resetsAt.toISOString()).toBe('2026-03-31T12:00:00.000Z');
  });

  it('handles a Feb 29 leap-year anchor across common years', () => {
    const anchor = at('2024-02-29T09:30:00.000Z');

    const commonFeb = cleanupPeriodFor(anchor, at('2026-02-20T00:00:00.000Z'));
    expect(commonFeb.periodStart.toISOString()).toBe('2026-01-29T09:30:00.000Z');
    expect(commonFeb.resetsAt.toISOString()).toBe('2026-02-28T09:30:00.000Z');

    const afterClamp = cleanupPeriodFor(anchor, at('2026-03-15T00:00:00.000Z'));
    expect(afterClamp.periodStart.toISOString()).toBe('2026-02-28T09:30:00.000Z');
    expect(afterClamp.resetsAt.toISOString()).toBe('2026-03-29T09:30:00.000Z');

    const leapFeb = cleanupPeriodFor(anchor, at('2028-02-29T09:30:00.000Z'));
    // Exact anniversary in a leap year — the new period starts now.
    expect(leapFeb.periodStart.toISOString()).toBe('2028-02-29T09:30:00.000Z');
    expect(leapFeb.resetsAt.toISOString()).toBe('2028-03-29T09:30:00.000Z');
  });

  it('immediately before reset the old period still owns the quota', () => {
    const anchor = at('2026-05-15T08:00:00.000Z');
    const { periodStart, resetsAt } = cleanupPeriodFor(anchor, at('2026-06-15T07:59:59.999Z'));
    expect(periodStart.toISOString()).toBe('2026-05-15T08:00:00.000Z');
    expect(resetsAt.toISOString()).toBe('2026-06-15T08:00:00.000Z');
  });

  it('the exact reset instant begins the new period (fresh quota)', () => {
    const anchor = at('2026-05-15T08:00:00.000Z');
    const { periodStart, resetsAt } = cleanupPeriodFor(anchor, at('2026-06-15T08:00:00.000Z'));
    expect(periodStart.toISOString()).toBe('2026-06-15T08:00:00.000Z');
    expect(resetsAt.toISOString()).toBe('2026-07-15T08:00:00.000Z');
  });

  it('immediately after reset the new period holds', () => {
    const anchor = at('2026-05-15T08:00:00.000Z');
    const { periodStart, resetsAt } = cleanupPeriodFor(anchor, at('2026-06-15T08:00:00.001Z'));
    expect(periodStart.toISOString()).toBe('2026-06-15T08:00:00.000Z');
    expect(resetsAt.toISOString()).toBe('2026-07-15T08:00:00.000Z');
  });

  it('a brand-new workspace sits in period zero from its anchor', () => {
    const anchor = at('2026-07-27T10:00:00.000Z');
    const { periodStart, resetsAt } = cleanupPeriodFor(anchor, at('2026-07-27T10:00:00.500Z'));
    expect(periodStart.toISOString()).toBe(anchor.toISOString());
    expect(resetsAt.toISOString()).toBe('2026-08-27T10:00:00.000Z');
  });

  it('never computes a period before the anchor under clock skew', () => {
    const anchor = at('2026-07-27T10:00:00.000Z');
    const { periodStart } = cleanupPeriodFor(anchor, at('2026-07-27T09:59:59.000Z'));
    expect(periodStart.toISOString()).toBe(anchor.toISOString());
  });
});
