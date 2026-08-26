import { z } from 'zod';

/**
 * Daily Brief schedule preferences (D64).
 *
 * Stored under `users.preferences.briefPrefs` (jsonb bag — no new
 * table, same pattern as `emailPrefs`). D64: the Brief is delivered at
 * 8am in the user's local timezone by default, and the hour is
 * user-configurable from Settings → "Daily Brief".
 *
 * Shared between the API (PATCH /api/me/brief-prefs, GET
 * /api/me/settings) and the BriefSnapshotWorker (generation-time hour
 * gate) so both sides read the same key with the same default.
 *
 * HOURLY GRANULARITY, deliberately. The snapshot worker is an hourly
 * cron (D203/D225), so an hour is the finest slot generation can
 * actually honour — a 30-minute slot would silently round up to the
 * next tick. D64's body says "any 30-min slot"; delivering that means
 * doubling the cron rate for a precision nobody has asked for, so this
 * ships hourly and the deviation is recorded for the founder rather
 * than resolved silently (FOUNDER-FOLLOWUPS 2026-08-25).
 *
 * The weekday-only schedule this key used to carry (`weekends`,
 * D66) is retired: the Brief now generates every day. A legacy
 * `{ weekends: … }` bag fails the strict parse below and falls back to
 * the default hour, which is the correct outcome — the preference no
 * longer exists and the next write replaces the key outright.
 */
export const BriefPrefsSchema = z
  .object({
    /**
     * Local hour the Brief is generated at, 0–23. Default 8 (D64).
     *
     * 0 is allowed and degrades gracefully rather than being special-
     * cased: generating at local midnight maximises the window where
     * incremental sync has not yet backfilled yesterday, so the first
     * run of the day can legitimately count zero. The worker's D70
     * empty-brief heal already covers exactly that — an empty run stays
     * replaceable and is rebuilt on later ticks (2026-07-07).
     */
    hour: z.number().int().min(0).max(23),
  })
  .strict();

export type BriefPrefs = z.infer<typeof BriefPrefsSchema>;

/** D64 — 8am local, the default delivery time. */
export const BRIEF_DEFAULT_HOUR = 8;

export const DEFAULT_BRIEF_PREFS: BriefPrefs = { hour: BRIEF_DEFAULT_HOUR };

/**
 * PATCH /api/me/brief-prefs request body. `.strict()` rejects unknown
 * keys so a typo'd key is a 400, not a silent no-op. The bag carries a
 * single setting, so the patch requires it — there is no partial write
 * to express.
 */
export const BriefPrefsPatchSchema = z
  .object({
    hour: z.number().int().min(0).max(23),
  })
  .strict();

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
