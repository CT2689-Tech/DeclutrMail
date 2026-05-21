'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell, ToastHost } from '@declutrmail/shared';
import { SENDERS } from '@/features/senders/data';

/**
 * Authed app chrome. Wires the routing-agnostic AppShell to the
 * Next.js router — `active` from the path, `onNavigate` to `router.push`.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const active = pathname.split('/')[1] || 'senders';

  return (
    <>
      <AppShell
        active={active}
        onNavigate={(id) => router.push(`/${id}`)}
        counts={{ senders: SENDERS.length }}
      >
        {children}
      </AppShell>
      <ToastHost />
    </>
  );
}
