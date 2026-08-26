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
});
