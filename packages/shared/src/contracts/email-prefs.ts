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
  })
  .strict();

export type EmailPrefs = z.infer<typeof EmailPrefsSchema>;

export const DEFAULT_EMAIL_PREFS: EmailPrefs = { reminders: true, syncComplete: true };

/**
 * PATCH /api/me/email-prefs request body. All keys optional — a patch
 * sets only what it carries. `.strict()` rejects unknown keys so a
 * typo'd key is a 400, not a silent no-op.
 */
export const EmailPrefsPatchSchema = z
  .object({
    reminders: z.boolean().optional(),
    syncComplete: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Patch must set at least one preference.',
  });

export type EmailPrefsPatch = z.infer<typeof EmailPrefsPatchSchema>;

/**
 * Stored bags written before a key existed lack that key — parse them
 * PARTIALLY and fill the gap from defaults, so adding a category can
 * never wipe an existing opt-out (a strict full-object parse would
 * fail on `{ reminders: false }` and silently reset it to `true`).
 */
const EmailPrefsPartialSchema = EmailPrefsSchema.partial();

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
  };
}
