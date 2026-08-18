import { describe, expect, it } from 'vitest';

import { formatPauseDate } from './paused-banner';

// Exact strings: the banner is server-rendered into hydrated HTML on
// /autopilot when every rule is paused, so the label must be identical
// on the server and in any browser locale/zone (React #418; e2e
// hydration-smoke). The user zone decides the calendar day.
describe('formatPauseDate', () => {
  it('renders the exact pinned label in the user zone, never the machine zone', () => {
    // 20:00 UTC is already the NEXT day in IST.
    expect(formatPauseDate('2026-08-10T20:00:00Z', 'Asia/Kolkata')).toBe('Aug 11, 2026');
    expect(formatPauseDate('2026-08-10T20:00:00Z', 'UTC')).toBe('Aug 10, 2026');
  });

  it('passes through an unparseable stamp unchanged', () => {
    expect(formatPauseDate('not-a-time', 'UTC')).toBe('not-a-time');
  });
});
