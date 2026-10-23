import 'server-only';

import type { ReactNode } from 'react';
import { hasCapability } from '@declutrmail/shared/entitlements';
import { getServerMe } from '@/features/auth/api/server-me';
import { screenerQueueQueryOptions } from '@/features/screener/api/query-options';
import type { ScreenerQueueRow } from '@/features/screener/data';
import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

/** Same first-review query and capability boundary as the former route. */
export async function ServerFirstReviewBoundary({
  cookieHeader,
  enabled,
  children,
}: {
  cookieHeader: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const me = enabled ? await getServerMe(cookieHeader) : null;
  const mailboxId = me?.activeMailboxId ?? undefined;
  const canRead = mailboxId !== undefined && me !== null && hasCapability(me.tier, 'screener');
  return ServerQueryHydration({
    surface: 'screener',
    prefetch: (queryClient) =>
      canRead
        ? [
            queryClient.fetchQuery(
              screenerQueueQueryOptions((signal) =>
                serverGet<ScreenerQueueRow[]>('/api/screener/queue', cookieHeader, signal, {
                  mailboxId,
                }),
              ),
            ),
          ]
        : [],
    children,
  });
}
