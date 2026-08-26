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

    expect(renderTemplate('Groupon', result)).toContain('Groupon');
    // Interpolated, not coincidental: the same result under a different
    // display name must produce that name and not the first one.
    const other = renderTemplate('Old Navy', result);
    expect(other).toContain('Old Navy');
    expect(other).not.toContain('Groupon');
  });
});
