import { describe, expect, it } from 'vitest';

import { scoredAge, scoredAgeLabel } from './engine-read-age';

describe('scoredAge', () => {
  const now = new Date('2026-08-19T12:00:00.000Z');
  const cases: Array<[string, string]> = [
    ['2026-08-19T09:00:00.000Z', 'today'],
    ['2026-08-18T09:00:00.000Z', 'yesterday'],
    ['2026-08-15T12:00:00.000Z', '4 days ago'],
    ['2026-08-11T12:00:00.000Z', 'a week ago'],
    // 26 days — still weeks; 30 days crosses into the months branch.
    ['2026-07-24T12:00:00.000Z', '4 weeks ago'],
    ['2026-07-20T12:00:00.000Z', 'a month ago'],
    ['2026-05-20T12:00:00.000Z', '3 months ago'],
    ['2025-08-19T12:00:00.000Z', 'a year ago'],
  ];
  it.each(cases)('renders %s as %s', (iso, expected) => {
    expect(scoredAge(iso, now)).toBe(expected);
  });

  it('says nothing for an unparseable or future timestamp', () => {
    expect(scoredAge('not-a-date', now)).toBeNull();
    expect(scoredAge('2026-09-01T00:00:00.000Z', now)).toBeNull();
  });

  /**
   * The whole point of moving this out of `recommendation-banner.tsx`
   * was that three surfaces render it. If the label ever stops deriving
   * from `scoredAge`, Triage and Sender Detail can word the same fact
   * differently — so the test asserts the composition, not a literal.
   */
  it('labels every age it can express, and stays silent when it cannot', () => {
    for (const [iso, expected] of cases) {
      // QA-sender-detail-20260902-08: "scored" is the scoring engine's
      // own vocabulary — "Last checked" says the same fact without it.
      expect(scoredAgeLabel(iso, now)).toBe(`Last checked ${expected}`);
    }
    expect(scoredAgeLabel('not-a-date', now)).toBeNull();
  });

  /**
   * Locale/zone independence (D200 hydration determinism). A server
   * rendering in UTC and a browser in a negative-offset zone must
   * produce the same string for the same input, or the age label
   * becomes a hydration mismatch on every triage row.
   */
  it('does not depend on the ambient timezone', () => {
    const iso = '2026-08-01T23:30:00.000Z';
    // Same instant, two representations — the arithmetic runs on epoch
    // ms, so the offset in the literal must not change the answer.
    expect(scoredAge(iso, now)).toBe(scoredAge('2026-08-01T16:30:00.000-07:00', now));
  });
});
