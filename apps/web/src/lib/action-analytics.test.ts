import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/posthog', () => ({ track: h.track }));

import { trackActionConfirmed } from './action-analytics';

describe('trackActionConfirmed', () => {
  it('defaults journey to daily', () => {
    h.track.mockClear();
    trackActionConfirmed('archive');
    expect(h.track).toHaveBeenCalledWith('action_confirmed', {
      journey: 'daily',
      verb: 'archive',
    });
  });

  it('passes first_relief through when the caller is the onboarding session', () => {
    h.track.mockClear();
    trackActionConfirmed('keep', 'first_relief');
    expect(h.track).toHaveBeenCalledWith('action_confirmed', {
      journey: 'first_relief',
      verb: 'keep',
    });
  });
});
