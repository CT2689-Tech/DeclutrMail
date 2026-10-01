// /autopilot — preset rule review surface (D99–D105, D192, D197).
//
// Which tier grants what is the manifest's business, not this file's —
// the surface gates on `hasCapability`, so it needs no tier name. An
// under-tier user mounts only the capability-exempt preset-catalog
// read; suggestions and every mutation stay unmounted and server-gated.

import { headers } from 'next/headers';

import { AutopilotEntitlementSurface } from '@/features/autopilot/autopilot-entitlement-surface';
import { autopilotRulesQueryOptions } from '@/features/autopilot/api/query-options';
import { getServerMe } from '@/features/auth/api/server-me';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

export const metadata = {
  title: 'Autopilot — DeclutrMail',
};

export default async function AutopilotPage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);
  const mailboxId = me?.activeMailboxId ?? undefined;

  return (
    <ServerQueryHydration
      surface="autopilot"
      prefetch={(queryClient) => {
        if (mailboxId === undefined) return [];
        const mailboxOptions = { mailboxId };
        const queries: Array<Promise<unknown>> = [
          queryClient.fetchQuery(
            autopilotRulesQueryOptions((signal) =>
              serverGet<AutopilotRuleDto[]>(
                '/api/autopilot/rules',
                cookieHeader,
                signal,
                mailboxOptions,
              ),
            ),
          ),
        ];
        return queries;
      }}
    >
      <AutopilotEntitlementSurface />
    </ServerQueryHydration>
  );
}
