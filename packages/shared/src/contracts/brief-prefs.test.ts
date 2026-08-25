// Tests for the D64 Brief schedule preference contract — the default
// delivery hour, malformed-bag fallbacks, and the PATCH shape.

import { describe, expect, it } from 'vitest';

import {
  BRIEF_DEFAULT_HOUR,
  BriefPrefsPatchSchema,
  DEFAULT_BRIEF_PREFS,
  parseBriefPrefs,
} from './brief-prefs';

describe('parseBriefPrefs (D64)', () => {
  it('defaults to 8am local', () => {
    expect(BRIEF_DEFAULT_HOUR).toBe(8);
    expect(DEFAULT_BRIEF_PREFS).toEqual({ hour: 8 });
    expect(parseBriefPrefs({})).toEqual({ hour: 8 });
    expect(parseBriefPrefs(undefined)).toEqual({ hour: 8 });
    expect(parseBriefPrefs(null)).toEqual({ hour: 8 });
  });

  it('reads a persisted hour, including the midnight edge', () => {
    expect(parseBriefPrefs({ briefPrefs: { hour: 17 } })).toEqual({ hour: 17 });
    expect(parseBriefPrefs({ briefPrefs: { hour: 0 } })).toEqual({ hour: 0 });
    expect(parseBriefPrefs({ briefPrefs: { hour: 23 } })).toEqual({ hour: 23 });
  });

  it('falls back to defaults on a malformed briefPrefs key (never throws)', () => {
    expect(parseBriefPrefs({ briefPrefs: 'eight' })).toEqual(DEFAULT_BRIEF_PREFS);
    expect(parseBriefPrefs({ briefPrefs: { hour: '8' } })).toEqual(DEFAULT_BRIEF_PREFS);
    expect(parseBriefPrefs({ briefPrefs: { hour: 8.5 } })).toEqual(DEFAULT_BRIEF_PREFS);
    expect(parseBriefPrefs({ briefPrefs: { hour: 24 } })).toEqual(DEFAULT_BRIEF_PREFS);
    expect(parseBriefPrefs({ briefPrefs: { hour: -1 } })).toEqual(DEFAULT_BRIEF_PREFS);
    expect(parseBriefPrefs({ briefPrefs: { hour: 8, extra: 1 } })).toEqual(DEFAULT_BRIEF_PREFS);
  });

  it('falls back to the default hour for a retired D66 weekends bag', () => {
    // The weekday-only schedule is gone; a bag written before this
    // change must resolve to the default rather than throwing or
    // leaking a `weekends` key onward.
    expect(parseBriefPrefs({ briefPrefs: { weekends: true } })).toEqual(DEFAULT_BRIEF_PREFS);
    expect(parseBriefPrefs({ briefPrefs: { weekends: false } })).toEqual(DEFAULT_BRIEF_PREFS);
  });
});

describe('BriefPrefsPatchSchema', () => {
  it('accepts an hour patch across the full range', () => {
    expect(BriefPrefsPatchSchema.safeParse({ hour: 0 }).success).toBe(true);
    expect(BriefPrefsPatchSchema.safeParse({ hour: 8 }).success).toBe(true);
    expect(BriefPrefsPatchSchema.safeParse({ hour: 23 }).success).toBe(true);
  });

  it('rejects an empty patch, an out-of-range hour, and unknown keys', () => {
    expect(BriefPrefsPatchSchema.safeParse({}).success).toBe(false);
    expect(BriefPrefsPatchSchema.safeParse({ hour: 24 }).success).toBe(false);
    expect(BriefPrefsPatchSchema.safeParse({ hour: -1 }).success).toBe(false);
    expect(BriefPrefsPatchSchema.safeParse({ hour: 8.5 }).success).toBe(false);
    expect(BriefPrefsPatchSchema.safeParse({ weekends: true }).success).toBe(false);
    expect(BriefPrefsPatchSchema.safeParse({ hour: 8, minute: 30 }).success).toBe(false);
  });
});
