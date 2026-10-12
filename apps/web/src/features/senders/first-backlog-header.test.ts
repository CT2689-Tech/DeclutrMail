import { describe, expect, it } from 'vitest';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';

import { firstBacklogHeader } from './first-backlog-header';

describe('firstBacklogHeader', () => {
  it('fills the deck sentence from exact counts', () => {
    expect(firstBacklogHeader(12, 40)).toBe(
      WS2_COPY.banners.firstBacklog.header.replaceAll('{k}', '12').replaceAll('{pct}', '40'),
    );
  });

  it('omits the sentence when either count is unavailable or not a whole share', () => {
    expect(firstBacklogHeader(null, 40)).toBeNull();
    expect(firstBacklogHeader(12, null)).toBeNull();
    expect(firstBacklogHeader(0, 40)).toBeNull();
    expect(firstBacklogHeader(12, 40.5)).toBeNull();
  });
});
