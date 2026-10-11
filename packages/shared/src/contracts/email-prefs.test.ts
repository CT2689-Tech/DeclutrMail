import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EMAIL_PREFS,
  EmailPrefsPatchSchema,
  parseEmailPrefs,
  hasBriefEmailConsent,
} from './email-prefs';

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

  it('preserves a legacy opt-out and defaults the weekly receipt to off', () => {
    // The migration-critical case: `{ reminders: false }` was a valid
    // full bag before D165's per-category expansion. A strict full
    // parse would fail and RESET the opt-out — the partial merge must
    // keep it.
    expect(parseEmailPrefs({ emailPrefs: { reminders: false } })).toEqual({
      reminders: false,
      syncComplete: true,
      weeklyReceipt: false,
      briefReady: false,
    });
  });

  it('fills the weekly default for a complete pre-weekly bag', () => {
    expect(parseEmailPrefs({ emailPrefs: { reminders: true, syncComplete: false } })).toEqual({
      reminders: true,
      syncComplete: false,
      weeklyReceipt: false,
      briefReady: false,
    });
  });

  it('keeps all existing opt-outs and defaults the new notice to off', () => {
    expect(
      parseEmailPrefs({
        emailPrefs: { reminders: false, syncComplete: false, weeklyReceipt: true },
      }),
    ).toEqual({ reminders: false, syncComplete: false, weeklyReceipt: true, briefReady: false });
  });

  it('falls back to defaults for malformed known values', () => {
    expect(parseEmailPrefs({ emailPrefs: 'garbage' })).toEqual(DEFAULT_EMAIL_PREFS);
    expect(parseEmailPrefs({ emailPrefs: { reminders: 'yes' } })).toEqual(DEFAULT_EMAIL_PREFS);
  });
});

it('ignores future keys without resurrecting known opt-outs', () => {
  expect(
    parseEmailPrefs({
      emailPrefs: { reminders: false, syncComplete: false, briefReady: true, marketing: true },
    }),
  ).toEqual({ reminders: false, syncComplete: false, weeklyReceipt: false, briefReady: true });
});

describe('EmailPrefsPatchSchema', () => {
  it('accepts single-key patches for each category', () => {
    expect(EmailPrefsPatchSchema.safeParse({ reminders: false }).success).toBe(true);
    expect(EmailPrefsPatchSchema.safeParse({ syncComplete: false }).success).toBe(true);
    expect(EmailPrefsPatchSchema.safeParse({ weeklyReceipt: true }).success).toBe(true);
    expect(EmailPrefsPatchSchema.safeParse({ briefReady: true }).success).toBe(true);
  });

  it('rejects empty patches, unknown keys, and non-boolean values', () => {
    expect(EmailPrefsPatchSchema.safeParse({}).success).toBe(false);
    expect(EmailPrefsPatchSchema.safeParse({ marketing: true }).success).toBe(false);
    expect(EmailPrefsPatchSchema.safeParse({ reminders: 'yes' }).success).toBe(false);
  });
});

describe('Brief explicit consent revision', () => {
  const revision = 'b1111111-0000-4000-8000-000000000001';
  it.each([
    [{ emailPrefs: { briefReady: true } }, false],
    [{ emailPrefs: { briefReady: true }, emailBriefOptInRevision: 'initial' }, true],
    [{ emailPrefs: { briefReady: false }, emailBriefOptInRevision: 'initial' }, false],
    [
      {
        emailPrefs: { briefReady: true },
        emailAllOptOutRevision: revision,
        emailBriefOptInRevision: revision,
      },
      true,
    ],
    [
      {
        emailPrefs: { briefReady: true },
        emailAllOptOutRevision: revision,
        emailBriefOptInRevision: 'initial',
      },
      false,
    ],
    [
      {
        emailPrefs: { briefReady: true },
        emailAllOptOutRevision: 'corrupted',
        emailBriefOptInRevision: 'corrupted',
      },
      false,
    ],
    [
      {
        emailPrefs: { briefReady: true },
        emailAllOptOutRevision: null,
        emailBriefOptInRevision: 'initial',
      },
      false,
    ],
    [{ emailPrefs: { briefReady: true }, emailBriefOptInRevision: null }, false],
  ])('validates explicit matching consent (%#)', (bag, expected) => {
    expect(hasBriefEmailConsent(bag)).toBe(expected);
  });
});
