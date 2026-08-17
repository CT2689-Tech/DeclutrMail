// apps/web/src/app/(app)/settings/senders/page.tsx
//
// Route: /settings/senders — Phase X3 standing-policies view.

import { headers } from 'next/headers';

import { getServerMe } from '@/features/auth/api/server-me';
import { ServerSendersBoundary } from '@/features/senders/server-senders-boundary';
import { SendersPoliciesScreen } from '@/features/settings/senders-policies/senders-policies-screen';

const PROTECTED_SENDERS_QUERY = { isProtected: true as const, limit: 50 };

export default async function SettingsSendersPage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const me = await getServerMe(cookieHeader);
  return (
    <ServerSendersBoundary
      cookieHeader={cookieHeader}
      enabled={me?.activeMailboxId != null}
      query={PROTECTED_SENDERS_QUERY}
      includeSummary={false}
      includeSettings={false}
    >
      <SendersPoliciesScreen />
    </ServerSendersBoundary>
  );
}
