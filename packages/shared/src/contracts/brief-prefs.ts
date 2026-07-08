import { z } from 'zod';

/**
 * Daily Brief schedule preferences (D66).
 *
 * Stored under `users.preferences.briefPrefs` (jsonb bag — no new
 * table, same pattern as `emailPrefs`). D66: Briefs generate Mon–Fri
 * by default; weekends are opt-in via Settings → Notifications →
 * "Generate Brief on weekends too."
 *
 * Shared between the API (PATCH /api/me/brief-prefs, GET
 * /api/me/settings) and the BriefSnapshotWorker (generation-time
 * weekend gate) so both sides read the same key with the same default.
 */
export const BriefPrefsSchema = z
  .object({
    /** Generate the Brief on Saturdays + Sundays too. Default false (D66). */
    weekends: z.boolean(),
  })
  .strict();

export type BriefPrefs = z.infer<typeof BriefPrefsSchema>;

export const DEFAULT_BRIEF_PREFS: BriefPrefs = { weekends: false };

/**
 * PATCH /api/me/brief-prefs request body. All keys optional — a patch
 * sets only what it carries. `.strict()` rejects unknown keys so a
 * typo'd key is a 400, not a silent no-op.
 */
export const BriefPrefsPatchSchema = z
  .object({
    weekends: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Patch must set at least one preference.',
  });

export type BriefPrefsPatch = z.infer<typeof BriefPrefsPatchSchema>;

/**
 * Read the Brief prefs out of a raw `users.preferences` bag, falling
 * back to defaults for a missing or malformed `briefPrefs` key. Never
 * throws — a bad preference bag must not take down Brief generation.
 */
export function parseBriefPrefs(preferences: unknown): BriefPrefs {
  if (typeof preferences !== 'object' || preferences === null) return DEFAULT_BRIEF_PREFS;
  const raw = (preferences as Record<string, unknown>).briefPrefs;
  const parsed = BriefPrefsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_BRIEF_PREFS;
}
