import { useQuery } from '@tanstack/react-query';

import { readMeSettings } from '@/features/settings/api/me-settings-reader';
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
 * Reads through the shared query options and reader rather than
 * `useMeSettings`, which imports the Triage store and would ship it in the
 * onboarding bundle. The onboarding server boundary seeds the same query,
 * so the gate's first render already knows the answer.
 */
export function useSyncReadyEmail(): boolean {
  const settings = useQuery(meSettingsQueryOptions(readMeSettings));
  return settings.data?.emailPrefs?.syncComplete === true;
}
