import { z } from 'zod';

/**
 * Email notification preferences (D162, D165).
 *
 * Stored under `users.preferences.emailPrefs` (jsonb bag — no new
 * table). D165 splits transactional email into:
 *
 *   - SYSTEM emails — sync-complete, deletion-scheduled,
 *     deletion-receipt. Non-opt-out (CAN-SPAM/GDPR carve-out for
 *     transactional mail); no preference key exists for them.
 *   - REMINDER emails — the 24h "your inbox is ready" nudge. Opt-out
 *     honored via `reminders: false`.
 *
 * Shared between the API (PATCH /api/me/email-prefs) and the
 * EmailSendWorker (execution-time opt-out check) so both sides read
 * the same key with the same defaults.
 */
export const EmailPrefsSchema = z
  .object({
    /** Re-engagement reminder emails (24h sync reminder). Default true. */
    reminders: z.boolean(),
  })
  .strict();

export type EmailPrefs = z.infer<typeof EmailPrefsSchema>;

export const DEFAULT_EMAIL_PREFS: EmailPrefs = { reminders: true };

/**
 * PATCH /api/me/email-prefs request body. All keys optional — a patch
 * sets only what it carries. `.strict()` rejects unknown keys so a
 * typo'd key is a 400, not a silent no-op.
 */
export const EmailPrefsPatchSchema = z
  .object({
    reminders: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Patch must set at least one preference.',
  });

export type EmailPrefsPatch = z.infer<typeof EmailPrefsPatchSchema>;

/**
 * Read the email prefs out of a raw `users.preferences` bag, falling
 * back to defaults for a missing or malformed `emailPrefs` key. Never
 * throws — preference reads must not take down a send path.
 */
export function parseEmailPrefs(preferences: unknown): EmailPrefs {
  if (typeof preferences !== 'object' || preferences === null) return DEFAULT_EMAIL_PREFS;
  const raw = (preferences as Record<string, unknown>).emailPrefs;
  const parsed = EmailPrefsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_EMAIL_PREFS;
}
