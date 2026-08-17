// /settings — Settings index (U23 — D34, D114, D116, D216).
//
// Sectioned single-page settings: Mailboxes, Action preferences (D34
// skip-sheet toggles), Email notifications, Sender lists link, Privacy
// & Data link, Plan & Billing summary, and the Account danger zone
// (#218's AccountDeletionSection). The `?cancelDeletion=1` deep link
// (from the deletion-scheduled email) scrolls to + highlights the
// Account section.

import { Suspense } from 'react';
import { headers } from 'next/headers';
import type { MeSettings, SyncStatus } from '@declutrmail/shared/contracts';

import { SettingsScreen } from '@/features/settings/settings-index/settings-screen';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';
import { billingSubscriptionQueryOptions } from '@/features/billing/api/query-options';
import { parseBillingSubscription } from '@/features/billing/api/parse-payload';
import { getServerMe } from '@/features/auth/api/server-me';
import {
  syncStatusQueryKey,
  syncStatusQueryOptions,
} from '@/features/onboarding/api/use-sync-status';
import {
  deriveMailboxHealth,
  type MailboxHealth,
} from '@/features/settings/api/use-mailbox-health';
import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

export const metadata = {
  title: 'Settings — DeclutrMail',
};

/**
 * Suspense boundary required because `SettingsScreen` reads the
 * `?cancelDeletion=1` deep link via `useSearchParams()`, which Next.js
 * requires to be wrapped at the route boundary in app-router.
 */
export default async function SettingsPage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);

  return (
    <ServerQueryHydration
      surface="settings"
      prefetch={(queryClient) => {
        if (me === null) return [];
        const queries: Array<Promise<unknown>> = [
          queryClient.fetchQuery(
            meSettingsQueryOptions((signal) =>
              serverGet<MeSettings>('/api/me/settings', cookieHeader, signal),
            ),
          ),
          queryClient.fetchQuery(
            billingSubscriptionQueryOptions(async (signal) =>
              parseBillingSubscription(
                await serverGet<unknown>('/api/billing/subscription', cookieHeader, signal),
              ),
            ),
          ),
        ];
        for (const mailbox of me.mailboxes) {
          if (mailbox.status !== 'active' || mailbox.id === me.activeMailboxId) continue;
          queries.push(
            queryClient.fetchQuery(
              syncStatusQueryOptions(mailbox.id, (signal) =>
                serverGet<SyncStatus>('/api/v1/sync/status', cookieHeader, signal, {
                  mailboxId: mailbox.id,
                }),
              ),
            ),
          );
        }
        return queries;
      }}
    >
      {(queryClient) => {
        const initialMailboxHealth: Record<string, MailboxHealth | undefined> = {};
        for (const mailbox of me?.mailboxes ?? []) {
          const status = queryClient.getQueryData<SyncStatus>(syncStatusQueryKey(mailbox.id));
          if (status !== undefined) initialMailboxHealth[mailbox.id] = deriveMailboxHealth(status);
        }
        return (
          <Suspense fallback={null}>
            <SettingsScreen initialMailboxHealth={initialMailboxHealth} />
          </Suspense>
        );
      }}
    </ServerQueryHydration>
  );
}
