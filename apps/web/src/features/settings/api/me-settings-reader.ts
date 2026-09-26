import type { MeSettings } from '@declutrmail/shared/contracts';

import { apiGet } from '@/lib/api/client';

/**
 * The one client-side fetcher for `ME_SETTINGS_QUERY_KEY`. Every client
 * hook that reads settings passes this to `meSettingsQueryOptions`, so the
 * shared cache entry cannot take a different shape depending on which hook
 * rendered last. Kept apart from `use-me-settings.ts`, which imports the
 * Triage store, so onboarding can read settings without shipping it.
 */
export async function readMeSettings(): Promise<MeSettings> {
  const env = await apiGet<MeSettings>('/api/me/settings');
  return env.data;
}
