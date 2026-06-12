import { describe, expect, it } from 'vitest';

import {
  ActionSheetPrefsPatchSchema,
  DEFAULT_ACTION_SHEET_PREFS,
  parseActionSheetPrefs,
} from './action-sheet-prefs';

/**
 * D34 action-sheet prefs contract — the parse function must never
 * throw (a corrupt `users.preferences` bag degrades to "sheet shows",
 * the safe default), and the patch schema must reject empty / unknown
 * keys so a typo is a 400 instead of a silent no-op.
 */
describe('parseActionSheetPrefs', () => {
  it('returns defaults for null / non-object preference bags', () => {
    expect(parseActionSheetPrefs(null)).toEqual(DEFAULT_ACTION_SHEET_PREFS);
    expect(parseActionSheetPrefs(undefined)).toEqual(DEFAULT_ACTION_SHEET_PREFS);
    expect(parseActionSheetPrefs('garbage')).toEqual(DEFAULT_ACTION_SHEET_PREFS);
  });

  it('returns defaults when the actionSheetPrefs key is missing or malformed', () => {
    expect(parseActionSheetPrefs({})).toEqual(DEFAULT_ACTION_SHEET_PREFS);
    expect(parseActionSheetPrefs({ actionSheetPrefs: 'no' })).toEqual(DEFAULT_ACTION_SHEET_PREFS);
    // Partial bags are malformed (schema requires all three verbs) —
    // the parse degrades whole, never half-applies.
    expect(parseActionSheetPrefs({ actionSheetPrefs: { archive: true } })).toEqual(
      DEFAULT_ACTION_SHEET_PREFS,
    );
  });

  it('reads a valid stored bag verbatim', () => {
    const stored = { archive: true, unsubscribe: false, later: true };
    expect(parseActionSheetPrefs({ actionSheetPrefs: stored })).toEqual(stored);
  });

  it('defaults to sheet-shows for every verb', () => {
    expect(DEFAULT_ACTION_SHEET_PREFS).toEqual({
      archive: false,
      unsubscribe: false,
      later: false,
    });
  });
});

describe('ActionSheetPrefsPatchSchema', () => {
  it('accepts a single-key patch', () => {
    expect(ActionSheetPrefsPatchSchema.safeParse({ archive: true }).success).toBe(true);
  });

  it('rejects an empty patch', () => {
    expect(ActionSheetPrefsPatchSchema.safeParse({}).success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    expect(ActionSheetPrefsPatchSchema.safeParse({ keep: true }).success).toBe(false);
    expect(ActionSheetPrefsPatchSchema.safeParse({ delete: true }).success).toBe(false);
  });
});
