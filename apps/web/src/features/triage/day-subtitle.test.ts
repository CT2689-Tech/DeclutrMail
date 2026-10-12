import { describe, expect, it } from 'vitest';
import { triageDaySubtitle } from './day-subtitle';

const NOW = Date.parse('2026-10-11T18:00:00.000Z');

describe('triageDaySubtitle', () => {
  it('uses the day-one line only inside the first 24 hours', () => {
    expect(triageDaySubtitle('2026-10-11T18:00:00.000Z', NOW)).toBe(
      'A few senders to start · one choice each',
    );
    expect(triageDaySubtitle(new Date(NOW - 24 * 60 * 60 * 1000 + 1).toISOString(), NOW)).toBe(
      'A few senders to start · one choice each',
    );
    expect(triageDaySubtitle(new Date(NOW - 24 * 60 * 60 * 1000).toISOString(), NOW)).toBe(
      'Today’s senders · one choice each',
    );
  });

  it('does not claim day one when the timestamp is missing', () => {
    expect(triageDaySubtitle(null, NOW)).toBe('Today’s senders · one choice each');
    expect(triageDaySubtitle(undefined, NOW)).toBe('Today’s senders · one choice each');
  });
});
