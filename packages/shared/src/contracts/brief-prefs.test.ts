// Tests for the D66 Brief schedule preference contract — the weekend
// opt-in default, malformed-bag fallbacks, and the PATCH shape.

import { describe, expect, it } from 'vitest';

import { BriefPrefsPatchSchema, DEFAULT_BRIEF_PREFS, parseBriefPrefs } from './brief-prefs';

describe('parseBriefPrefs (D66)', () => {
  it('defaults to weekends OFF (Mon–Fri only)', () => {
    expect(DEFAULT_BRIEF_PREFS).toEqual({ weekends: false });
    expect(parseBriefPrefs({})).toEqual({ weekends: false });
    expect(parseBriefPrefs(undefined)).toEqual({ weekends: false });
    expect(parseBriefPrefs(null)).toEqual({ weekends: false });
  });

  it('reads a persisted opt-in', () => {
    expect(parseBriefPrefs({ briefPrefs: { weekends: true } })).toEqual({ weekends: true });
  });

  it('falls back to defaults on a malformed briefPrefs key (never throws)', () => {
    expect(parseBriefPrefs({ briefPrefs: 'yes' })).toEqual(DEFAULT_BRIEF_PREFS);
    expect(parseBriefPrefs({ briefPrefs: { weekends: 'true' } })).toEqual(DEFAULT_BRIEF_PREFS);
    expect(parseBriefPrefs({ briefPrefs: { weekends: true, extra: 1 } })).toEqual(
      DEFAULT_BRIEF_PREFS,
    );
  });
});

describe('BriefPrefsPatchSchema', () => {
  it('accepts a weekends patch', () => {
    expect(BriefPrefsPatchSchema.safeParse({ weekends: true }).success).toBe(true);
  });

  it('rejects an empty patch and unknown keys', () => {
    expect(BriefPrefsPatchSchema.safeParse({}).success).toBe(false);
    expect(BriefPrefsPatchSchema.safeParse({ saturdays: true }).success).toBe(false);
  });
});
