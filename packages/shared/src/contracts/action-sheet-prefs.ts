import { z } from 'zod';

/**
 * Action-sheet skip preferences (D34 + D226).
 *
 * Stored under `users.preferences.actionSheetPrefs` (jsonb bag — no new
 * table, same pattern as `emailPrefs`). One boolean per sheetable verb:
 *
 *   - `true`  — skip the action SHEET for that verb; the mandatory
 *               action preview renders inline beside the row instead
 *               (D226: the sheet is skippable, the preview never is).
 *   - `false` — default; the sheet opens on every action.
 *
 * Keep is never sheeted (non-destructive), so no key exists for it.
 *
 * Shared between the API (GET /api/me/settings + PATCH
 * /api/me/action-sheet-prefs) and the FE triage store hydration so both
 * sides read the same key with the same defaults. Persisting on the
 * user record (not localStorage) makes the preference roam devices.
 */
export const ActionSheetPrefsSchema = z
  .object({
    /** Skip the sheet for Archive. Default false. */
    archive: z.boolean(),
    /** Skip the sheet for Unsubscribe. Default false. */
    unsubscribe: z.boolean(),
    /** Skip the sheet for Later. Default false. */
    later: z.boolean(),
  })
  .strict();

export type ActionSheetPrefs = z.infer<typeof ActionSheetPrefsSchema>;

/** Default — the sheet shows for every verb (D34). */
export const DEFAULT_ACTION_SHEET_PREFS: ActionSheetPrefs = {
  archive: false,
  unsubscribe: false,
  later: false,
};

/**
 * PATCH /api/me/action-sheet-prefs request body. All keys optional — a
 * patch sets only what it carries. `.strict()` rejects unknown keys so
 * a typo'd verb is a 400, not a silent no-op.
 */
export const ActionSheetPrefsPatchSchema = z
  .object({
    archive: z.boolean().optional(),
    unsubscribe: z.boolean().optional(),
    later: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Patch must set at least one preference.',
  });

export type ActionSheetPrefsPatch = z.infer<typeof ActionSheetPrefsPatchSchema>;

/**
 * Read the action-sheet prefs out of a raw `users.preferences` bag,
 * falling back to defaults for a missing or malformed
 * `actionSheetPrefs` key. Never throws — a corrupt preference bag must
 * degrade to "sheet shows" (the safe default), not a 500.
 */
export function parseActionSheetPrefs(preferences: unknown): ActionSheetPrefs {
  if (typeof preferences !== 'object' || preferences === null) return DEFAULT_ACTION_SHEET_PREFS;
  const raw = (preferences as Record<string, unknown>).actionSheetPrefs;
  const parsed = ActionSheetPrefsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_ACTION_SHEET_PREFS;
}
