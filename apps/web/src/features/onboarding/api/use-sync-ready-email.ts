import { useQuery } from '@tanstack/react-query';
import type { MeSettings } from '@declutrmail/shared/contracts';

import { apiGet } from '@/lib/api/client';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';

/**
 * Whether the "Your inbox is ready" email will go to this user (D109).
 * The sync gate only promises the email when this is true.
 *
 * `emailPrefs.syncComplete` is the per-user switch the send worker checks
 * before sending it, and unsubscribing from all mail turns it off too.
 * Unknown (loading or failed) reads as false, so the gate falls back to a
 * sentence that is true without the email.
 *
 * Reads through the shared query options rather than `useMeSettings`, which
 * imports the Triage store and would ship it in the onboarding bundle.
 */
export function useSyncReadyEmail(): boolean {
  const settings = useQuery(
    meSettingsQueryOptions(async () => (await apiGet<MeSettings>('/api/me/settings')).data),
  );
  return settings.data?.emailPrefs?.syncComplete === true;
}
