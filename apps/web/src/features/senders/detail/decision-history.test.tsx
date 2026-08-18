import { describe, expect, it } from 'vitest';

import { dateLabel } from './decision-history';

// Exact strings: the decision-history rows are server-rendered into
// hydrated HTML on /senders/[id], so the label must be identical on
// the server and in any browser locale/zone (React #418; e2e
// hydration-smoke). The user zone decides the calendar day.
describe('dateLabel', () => {
  const NOW = new Date('2026-08-18T08:00:00Z');

  it('renders the exact pinned month-day once older than a week', () => {
    // 20:00 UTC is already the NEXT day in IST.
    expect(dateLabel('2026-08-01T20:00:00Z', NOW, 'Asia/Kolkata')).toBe('Aug 2');
    expect(dateLabel('2026-08-01T20:00:00Z', NOW, 'UTC')).toBe('Aug 1');
  });

  it('stays relative inside the 7-day window', () => {
    expect(dateLabel('2026-08-16T08:00:00Z', NOW, 'Asia/Kolkata')).toBe('2d ago');
  });
});
