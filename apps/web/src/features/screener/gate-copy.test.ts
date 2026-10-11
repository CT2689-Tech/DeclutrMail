import { describe, expect, it } from 'vitest';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { screenerGateCount } from './gate-copy';

describe('screenerGateCount', () => {
  it('omits the count when it is unknown', () => {
    expect(screenerGateCount(null)).toBeNull();
  });

  it('uses the deck sentences when the count is known', () => {
    expect(screenerGateCount(1)).toBe(WS2_COPY.locked.screener.count.one);
    expect(screenerGateCount(4)).toBe('4 new senders have emailed you since you joined.');
  });
});
