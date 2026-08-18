import { headers } from 'next/headers';
import type { PaginatedEnvelope } from '@declutrmail/shared/contracts';

import { getServerMe } from '@/features/auth/api/server-me';
import { securityEventsQueryOptions } from '@/features/admin-security/api/query-options';
import { AdminSecurityEventsScreen } from '@/features/admin-security/security-events-screen';
import type { SecurityEventWire } from '@/lib/api/security-events';
import { serverGetEnvelope } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

/**
 * /admin/security route — operator audit log (D181 read).
 *
 * Thin route shell — layout, data fetching, state branches, and 404
 * handling live in `AdminSecurityEventsScreen` so they can be
 * exercised by tests and Storybook without dragging in the Next
 * router or the AdminAllowlistGuard.
 *
 * Server-side auth: BE route `/api/security-events` is gated by
 * `JwtGuard` + `AdminAllowlistGuard`. Non-allowlisted users receive
 * 404 from the BE; the screen renders the not-found surface and
 * never reveals the route's purpose.
 */
export default async function AdminSecurityPage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);
  const filters = {};
  return (
    <ServerQueryHydration
      surface="admin-security"
      prefetch={(queryClient) =>
        me === null
          ? []
          : [
              queryClient.fetchInfiniteQuery(
                securityEventsQueryOptions(filters, async (cursor, signal) => {
                  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
                  return serverGetEnvelope<
                    SecurityEventWire[],
                    PaginatedEnvelope<SecurityEventWire>['meta']
                  >(`/api/security-events${suffix}`, cookieHeader, signal) as Promise<
                    PaginatedEnvelope<SecurityEventWire>
                  >;
                }),
              ),
            ]
      }
    >
      <AdminSecurityEventsScreen />
    </ServerQueryHydration>
  );
}
