import { describe, expect, it } from 'vitest';

import { meterChipSentence, meterPreviewSentence } from './home-deck-copy';

describe('Home deck sentences', () => {
  it('builds the chip and preview from server numbers', () => {
    expect(
      meterChipSentence(
        {
          metered: true,
          limit: 1000,
          used: 360,
          remaining: 640,
          resetAt: '2026-11-01T00:00:00.000Z',
        },
        { timeZone: 'UTC' },
      ),
    ).toEqual({
      text: '640 emails left to clear · resets Nov 1',
      aria: '640 of 1,000 free emails left this month. Resets Nov 1.',
    });
    expect(meterPreviewSentence(1, 640)).toBe('This clears 1 email. You have 640 free this month.');
    expect(meterPreviewSentence(12, 640)).toBe(
      'This clears 12 emails. You have 640 free this month.',
    );
    expect(meterPreviewSentence(800, 640)).toBe(
      'This clears 800 emails. You have 640 free left this month.',
    );
    expect(meterPreviewSentence(1, 0)).toBe(
      'This clears 1 email, but you have no free emails left this month.',
    );
  });

  it('does not invent a chip for an unmetered summary or a zero-email preview', () => {
    expect(
      meterChipSentence(
        { metered: false, limit: 0, used: 0, remaining: 0, resetAt: '2026-11-01T00:00:00.000Z' },
        { timeZone: 'UTC' },
      ),
    ).toBeNull();
    expect(meterPreviewSentence(0, 10)).toBeNull();
  });
});
