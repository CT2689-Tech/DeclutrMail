import { z } from 'zod';

/**
 * Email notification preferences (D162, D165).
 *
 * Stored under `users.preferences.emailPrefs` (jsonb bag — no new
 * table). D165 splits transactional email into:
 *
 *   - SYSTEM emails — deletion-scheduled, deletion-receipt. Required
 *     account notices; non-opt-out (CAN-SPAM/GDPR carve-out for
 *     transactional mail); no preference key exists for them.
 *   - PER-CATEGORY toggles — one key per opt-out-able email kind:
 *       `reminders`    — the 24h "your inbox is still ready" nudge.
 *       `syncComplete` — the "your inbox is ready" completion alert
 *                        (D114 Notifications section's "completion
 *                        alerts").
 *       `weeklyReceipt` — the Plus/Pro weekly Screener value receipt
 *                         (D189 amended by D251). Default off.
 *
 * Shared between the API (PATCH /api/me/email-prefs) and the
 * EmailSendWorker (execution-time opt-out check) so both sides read
 * the same key with the same defaults.
 */
export const EmailPrefsSchema = z
  .object({
    /** Re-engagement reminder emails (24h sync reminder). Default true. */
    reminders: z.boolean(),
    /** "Your inbox is ready" sync-completion alerts. Default true. */
    syncComplete: z.boolean(),
    /** Plus/Pro weekly Screener value receipt. Default false. */
    weeklyReceipt: z.boolean(),
    /** Daily Brief counts/link notice. Explicit opt-in; default false. */
    briefReady: z.boolean(),
  })
  .strict();

export type EmailPrefs = z.infer<typeof EmailPrefsSchema>;

export const DEFAULT_EMAIL_PREFS: EmailPrefs = {
  reminders: true,
  syncComplete: true,
  weeklyReceipt: false,
  briefReady: false,
};

/**
 * PATCH /api/me/email-prefs request body. All keys optional — a patch
 * sets only what it carries. `.strict()` rejects unknown keys so a
 * typo'd key is a 400, not a silent no-op.
 */
export const EmailPrefsPatchSchema = z
  .object({
    reminders: z.boolean().optional(),
    syncComplete: z.boolean().optional(),
    weeklyReceipt: z.boolean().optional(),
    briefReady: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Patch must set at least one preference.',
  });

export type EmailPrefsPatch = z.infer<typeof EmailPrefsPatchSchema>;

/**
 * Stored bags written before a key existed lack that key — parse them
 * PARTIALLY, ignore future categories, and fill the gap from defaults.
 * Reads tolerate mixed versions while PATCH stays strict, so adding a category can
 * never wipe an existing opt-out (a strict full-object parse would
 * fail on `{ reminders: false }` and silently reset it to `true`).
 */
const EmailPrefsPartialSchema = EmailPrefsSchema.partial().strip();

/**
 * Read the email prefs out of a raw `users.preferences` bag, falling
 * back to defaults for a missing or malformed `emailPrefs` key (and to
 * per-key defaults for keys the stored bag predates). Never throws —
 * preference reads must not take down a send path.
 */
export function parseEmailPrefs(preferences: unknown): EmailPrefs {
  if (typeof preferences !== 'object' || preferences === null) return DEFAULT_EMAIL_PREFS;
  const raw = (preferences as Record<string, unknown>).emailPrefs;
  const parsed = EmailPrefsPartialSchema.safeParse(raw);
  if (!parsed.success) return DEFAULT_EMAIL_PREFS;
  // Fill each absent key from its default (`??` keeps a stored `false`).
  return {
    reminders: parsed.data.reminders ?? DEFAULT_EMAIL_PREFS.reminders,
    syncComplete: parsed.data.syncComplete ?? DEFAULT_EMAIL_PREFS.syncComplete,
    weeklyReceipt: parsed.data.weeklyReceipt ?? DEFAULT_EMAIL_PREFS.weeklyReceipt,
    briefReady: parsed.data.briefReady ?? DEFAULT_EMAIL_PREFS.briefReady,
  };
}

/** A legacy bag has the initial all-unsubscribe revision, but never implicit consent. */
export const INITIAL_EMAIL_OPT_OUT_REVISION = 'initial';
export const EMAIL_OPT_OUT_REVISION_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const revisionPattern = new RegExp(EMAIL_OPT_OUT_REVISION_PATTERN);
export function hasBriefEmailConsent(preferences: unknown): boolean {
  if (
    !parseEmailPrefs(preferences).briefReady ||
    typeof preferences !== 'object' ||
    preferences === null
  )
    return false;
  const bag = preferences as Record<string, unknown>;
  const all =
    bag.emailAllOptOutRevision === undefined
      ? INITIAL_EMAIL_OPT_OUT_REVISION
      : bag.emailAllOptOutRevision;
  const consent = bag.emailBriefOptInRevision;
  return (
    typeof consent === 'string' &&
    (consent === INITIAL_EMAIL_OPT_OUT_REVISION || revisionPattern.test(consent)) &&
    consent === all
  );
}

/** Settings displays executable consent, including older-API all-unsubscribe invalidation. */
export function displayEmailPrefs(preferences: unknown): EmailPrefs {
  return { ...parseEmailPrefs(preferences), briefReady: hasBriefEmailConsent(preferences) };
}
