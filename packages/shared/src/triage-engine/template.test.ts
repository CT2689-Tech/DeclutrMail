import { describe, expect, it } from 'vitest';

import { runCascade, renderTemplate } from './index';

describe('renderTemplate', () => {
  it('names the sender and its measured read rate', () => {
    const result = runCascade({
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'promotions',
      starredInLastYear: false,
      readRate90d: 0,
      firstSeenMonthsAgo: 24,
      firstSeenDaysAgo: 730,
      lastSeenDaysAgo: 0,
      totalMessages: 1745,
      monthlyVolume: 52,
      spikeRatio: 3,
      unsubscribeChannel: 'one_click',
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    });

    const rendered = renderTemplate('Groupon', result);
    expect(rendered).toContain('Groupon');
    // readRate90d: 0 above yields a measured (non-null) readRatePct of 0,
    // so the clause is printed, not dropped — see the `readPct === null`
    // branch in `renderTemplate`, which drops it only for an unmeasurable
    // rate, never for a measured 0%.
    expect(rendered).toContain('0% marked read over 90d.');
    // Interpolated, not coincidental: the same result under a different
    // display name must produce that name and not the first one.
    const other = renderTemplate('Old Navy', result);
    expect(other).toContain('Old Navy');
    expect(other).not.toContain('Groupon');
  });

  // QA-sender-detail-20260902-01 (sibling): the only prior test seeded
  // `monthlyVolume: 52`, an integer, so neither the zero nor the
  // fractional case was ever exercised — a green test asserting what its
  // author believed. `readRate90d: null` is the production shape for a
  // sender with zero 90-day volume (`computeReadRate` returns null only
  // then), so `monthlyVolume: 0` here mirrors what the API actually sends.
  it('does not claim a dormant sender sends 0/mo', () => {
    const result = runCascade({
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'promotions',
      starredInLastYear: false,
      readRate90d: null,
      firstSeenMonthsAgo: 24,
      firstSeenDaysAgo: 730,
      lastSeenDaysAgo: 400,
      totalMessages: 1,
      monthlyVolume: 0,
      spikeRatio: 1,
      unsubscribeChannel: 'none',
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    });

    const rendered = renderTemplate('Old eBay Feedback', result);
    expect(rendered).not.toContain('0/mo');
    expect(rendered).not.toContain('sends 0');
    expect(rendered).toContain("hasn't sent anything in the last 90 days");
  });

  it('rounds a fractional monthly cadence instead of printing a raw float', () => {
    const result = runCascade({
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'promotions',
      starredInLastYear: false,
      readRate90d: 0,
      firstSeenMonthsAgo: 24,
      firstSeenDaysAgo: 730,
      lastSeenDaysAgo: 10,
      totalMessages: 1,
      monthlyVolume: 1 / 3,
      spikeRatio: 1,
      unsubscribeChannel: 'none',
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    });

    const rendered = renderTemplate('Quarterly Sender', result);
    expect(rendered).not.toContain('0.3333333333333333');
    expect(rendered).toContain('0.3/mo');
  });

  // Codex adversarial review, round 2: rounding to one decimal BEFORE
  // checking for zero volume meant a positive-but-tiny raw value rounded
  // to 0.0 and triggered the "hasn't sent anything" branch — false for a
  // sender who did send something. Not reachable from today's only
  // producer (score.worker.ts's `volume90 / 3`, whose smallest nonzero
  // result is 1/3), but the exported `CascadeResult` type permits it.
  it('does not claim a sender with a tiny but positive volume sent nothing', () => {
    const result = runCascade({
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'promotions',
      starredInLastYear: false,
      readRate90d: 1,
      firstSeenMonthsAgo: 24,
      firstSeenDaysAgo: 730,
      lastSeenDaysAgo: 10,
      totalMessages: 1,
      monthlyVolume: 0.04,
      spikeRatio: 1,
      unsubscribeChannel: 'none',
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    });

    const rendered = renderTemplate('Tiny Volume Sender', result);
    expect(rendered).not.toContain("hasn't sent anything");
    expect(rendered).toContain('0/mo');
  });
});
