// /autopilot — preset rule review surface (D99–D105, D192, D197).
//
// Active execution stays Pro-only per the D19 manifest. Under-tier users
// mount only the capability-exempt preset-catalog read; suggestions and
// every mutation remain unmounted and server-gated.

import { headers } from 'next/headers';
import { hasCapability } from '@declutrmail/shared/entitlements';

import { AutopilotEntitlementSurface } from '@/features/autopilot/autopilot-entitlement-surface';
import {
  autopilotRulesQueryOptions,
  patternSuggestionQueryOptions,
  pendingSuggestionsQueryOptions,
} from '@/features/autopilot/api/query-options';
import { getServerMe } from '@/features/auth/api/server-me';
import type {
  AutopilotMatchDto,
  AutopilotPatternSuggestionDto,
  AutopilotRuleDto,
} from '@/lib/api/autopilot';
import { serverGet } from '@/lib/api/server';
import { ServerQueryHydration } from '@/lib/server-query-hydration';

export const metadata = {
  title: 'Autopilot — DeclutrMail',
};

export default async function AutopilotPage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);
  const mailboxId = me?.activeMailboxId ?? undefined;
  const fullSurface = me !== null && hasCapability(me.tier, 'autopilot');

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
        if (fullSurface) {
          queries.push(
            queryClient.fetchQuery(
              pendingSuggestionsQueryOptions((signal) =>
                serverGet<AutopilotMatchDto[]>(
                  '/api/autopilot/pending-suggestions',
                  cookieHeader,
                  signal,
                  mailboxOptions,
                ),
              ),
            ),
            queryClient.fetchQuery(
              patternSuggestionQueryOptions((signal) =>
                serverGet<AutopilotPatternSuggestionDto | null>(
                  '/api/autopilot/pattern-suggestion',
                  cookieHeader,
                  signal,
                  mailboxOptions,
                ),
              ),
            ),
          );
        }
        return queries;
      }}
    >
      <AutopilotEntitlementSurface />
    </ServerQueryHydration>
  );
}
