// QA-archive-20260828-03 — Sender Detail had two independently-written
// day-count algorithms (an elapsed-24h `Math.floor` here, an elapsed-24h
// `Math.round` in `sender-detail-page.tsx`), both different from the
// shared calendar-midnight `daysSince` the rest of the app uses. They
// could disagree by exactly one day for anything received within the
// last ~24h but before local midnight — this test pins the case that
// used to read "today" here and "yesterday" in the timeline.

import { describe, expect, it } from 'vitest';
import { relTimeFromIso } from './data';

describe('relTimeFromIso — calendar-day boundary (QA-archive-20260828-03)', () => {
  it('reads "yesterday" for a message from the previous calendar day, even under 24h old', () => {
    // Constructed via local Date components (not fixed UTC offsets) so
    // the "crosses local midnight" relationship holds under any TZ the
    // test runs in.
    const then = new Date(2026, 7, 27, 20, 0, 0); // Aug 27, 8:00 PM local
    const now = new Date(2026, 7, 28, 1, 0, 0); // Aug 28, 1:00 AM local — 5h later

    // The old `Math.floor((now - then) / 86_400_000)` gave 0 → "today".
    // The shared `daysSince` gives 1, crossing one local midnight.
    expect(relTimeFromIso(then.toISOString(), now)).toBe('yesterday');
  });

  it('still reads "today" for same-calendar-day messages', () => {
    const then = new Date(2026, 7, 28, 9, 0, 0);
    const now = new Date(2026, 7, 28, 14, 0, 0);
    expect(relTimeFromIso(then.toISOString(), now)).toBe('today');
  });
});
