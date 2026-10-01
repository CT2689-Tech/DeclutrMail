// apps/web/src/app/(app)/settings/senders/page.tsx
//
// Route: /settings/senders — Phase X3 standing-policies view.

import { headers } from 'next/headers';

import { hasServerAccessCookie } from '@/features/auth/api/server-me';
import { ServerSendersBoundary } from '@/features/senders/server-senders-boundary';
import { SendersPoliciesScreen } from '@/features/settings/senders-policies/senders-policies-screen';

const PROTECTED_SENDERS_QUERY = { isProtected: true as const, limit: 50 };

export default async function SettingsSendersPage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  return (
    <ServerSendersBoundary
      cookieHeader={cookieHeader}
      enabled={hasServerAccessCookie(cookieHeader)}
      query={PROTECTED_SENDERS_QUERY}
      includeSettings={false}
    >
      <SendersPoliciesScreen />
    </ServerSendersBoundary>
  );
}
