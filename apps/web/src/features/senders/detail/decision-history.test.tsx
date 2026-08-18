import { describe, expect, it } from 'vitest';

import { dateLabel } from './decision-history';

// Exact strings, pinned locale + explicit zone (D200 hydration
// determinism class; React #418; e2e hydration-smoke). The component
// is currently unmounted (DecisionTimeline replaced it; deletion
// deferred) — the pin + test keep the retained file compliant with
// the features-wide lint ban.
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
