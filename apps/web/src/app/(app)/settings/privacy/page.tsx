// /settings/privacy — Privacy & Data sub-page (D116, D217, D228).
//
// The dedicated trust surface: the D228 privacy badge ("Full bodies
// fetched: 0" + the explicit storage list), indexed mailboxes, undo
// retention, the DPDP data export (JSON/CSV of allowlisted columns
// only), leave-cleanly pointers, and the CASA evidence row.

import { headers } from 'next/headers';

import { PrivacyDataRoute } from '@/features/settings/privacy-data/privacy-data-screen';
import { billingSubscriptionQueryOptions } from '@/features/billing/api/query-options';
import { parseBillingSubscription } from '@/features/billing/api/parse-payload';
import { getServerMe } from '@/features/auth/api/server-me';
import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

export const metadata = {
  title: 'Privacy & Data — DeclutrMail',
};

export default async function SettingsPrivacyPage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);
  return (
    <ServerQueryHydration
      surface="settings-privacy"
      prefetch={(queryClient) =>
        me === null
          ? []
          : [
              queryClient.fetchQuery(
                billingSubscriptionQueryOptions(async (signal) =>
                  parseBillingSubscription(
                    await serverGet<unknown>('/api/billing/subscription', cookieHeader, signal),
                  ),
                ),
              ),
            ]
      }
    >
      <PrivacyDataRoute />
    </ServerQueryHydration>
  );
}
