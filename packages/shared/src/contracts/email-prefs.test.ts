import { describe, expect, it } from 'vitest';

import { DEFAULT_EMAIL_PREFS, EmailPrefsPatchSchema, parseEmailPrefs } from './email-prefs';

/**
 * Email-prefs contract tests (D165) — the load-bearing case is the
 * legacy-bag merge: bags stored before `syncComplete` existed must keep
 * their `reminders` opt-out while the new key fills from defaults.
 */

describe('parseEmailPrefs', () => {
  it('returns defaults for a missing / non-object bag', () => {
    expect(parseEmailPrefs(undefined)).toEqual(DEFAULT_EMAIL_PREFS);
    expect(parseEmailPrefs(null)).toEqual(DEFAULT_EMAIL_PREFS);
    expect(parseEmailPrefs({})).toEqual(DEFAULT_EMAIL_PREFS);
  });

  it('preserves a pre-syncComplete opt-out and fills the new key from defaults', () => {
    // The migration-critical case: `{ reminders: false }` was a valid
    // full bag before D165's per-category expansion. A strict full
    // parse would fail and RESET the opt-out — the partial merge must
    // keep it.
    expect(parseEmailPrefs({ emailPrefs: { reminders: false } })).toEqual({
      reminders: false,
      syncComplete: true,
    });
  });

  it('reads a full two-key bag verbatim', () => {
    expect(parseEmailPrefs({ emailPrefs: { reminders: true, syncComplete: false } })).toEqual({
      reminders: true,
      syncComplete: false,
    });
  });

  it('falls back to defaults for malformed values and unknown keys', () => {
    expect(parseEmailPrefs({ emailPrefs: 'garbage' })).toEqual(DEFAULT_EMAIL_PREFS);
    expect(parseEmailPrefs({ emailPrefs: { reminders: 'yes' } })).toEqual(DEFAULT_EMAIL_PREFS);
    expect(parseEmailPrefs({ emailPrefs: { reminders: false, marketing: true } })).toEqual(
      DEFAULT_EMAIL_PREFS,
    );
  });
});

describe('EmailPrefsPatchSchema', () => {
  it('accepts single-key patches for either category', () => {
    expect(EmailPrefsPatchSchema.safeParse({ reminders: false }).success).toBe(true);
    expect(EmailPrefsPatchSchema.safeParse({ syncComplete: false }).success).toBe(true);
  });

  it('rejects empty patches, unknown keys, and non-boolean values', () => {
    expect(EmailPrefsPatchSchema.safeParse({}).success).toBe(false);
    expect(EmailPrefsPatchSchema.safeParse({ marketing: true }).success).toBe(false);
    expect(EmailPrefsPatchSchema.safeParse({ reminders: 'yes' }).success).toBe(false);
  });
});
