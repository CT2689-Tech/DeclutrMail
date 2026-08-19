import { describe, expect, it } from 'vitest';

import { shortDate } from './data';
import { absoluteFromIso } from './detail/data';
import { formatReadRatePct } from './fact-language';

/**
 * The three formatters F006/F008 introduced or moved.
 *
 * They existed for one pass with only a doc comment asserting their
 * behaviour — including a claim that "tests pass an explicit zone for
 * exact-string determinism" when no such test existed. In a codebase
 * whose dominant defect class is surfaces asserting what they don't
 * know, an unbacked claim in a comment is the same bug in prose. These
 * are that claim, made true.
 */

describe('absoluteFromIso', () => {
  it('renders a pinned en-US medium date + short time in an explicit zone', () => {
    // Explicit zone is what makes this assertable at all — without it
    // the string follows whatever machine runs the test.
    expect(absoluteFromIso('2026-08-16T13:42:07.000Z', 'UTC')).toBe('Aug 16, 2026, 1:42 PM');
  });

  it('reflects the zone it is given rather than the runner locale', () => {
    expect(absoluteFromIso('2026-08-16T13:42:07.000Z', 'Asia/Kolkata')).toBe(
      'Aug 16, 2026, 7:12 PM',
    );
  });

  it("returns '' for an unparseable value instead of 'Invalid Date'", () => {
    expect(absoluteFromIso('not-a-date', 'UTC')).toBe('');
  });
});

describe('shortDate', () => {
  it('emits YYYY-MM-DD so it cannot be misread as D/M vs M/D', () => {
    // Local calendar parts by design; asserted mid-day UTC so the date
    // component is stable across the zones a dev machine might use.
    expect(shortDate('2026-08-16T12:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns '' for an unparseable value", () => {
    expect(shortDate('not-a-date')).toBe('');
    expect(shortDate('')).toBe('');
  });
});

describe('formatReadRatePct', () => {
  it("renders a real but sub-1% signal as '<1', never a measured 0", () => {
    // The whole point: 1 read in 250 is not the same fact as 0 reads,
    // and the pre-multiply rounding used to collapse them.
    expect(formatReadRatePct(0.004)).toBe('<1');
    expect(formatReadRatePct(1 / 250)).toBe('<1');
  });

  it('renders a genuine zero as 0', () => {
    expect(formatReadRatePct(0)).toBe('0');
  });

  it('rounds ordinary rates to whole percents', () => {
    expect(formatReadRatePct(0.1111)).toBe('11');
    expect(formatReadRatePct(0.965)).toBe('97');
    expect(formatReadRatePct(1)).toBe('100');
  });
});
