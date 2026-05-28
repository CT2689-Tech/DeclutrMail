'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell, ToastHost } from '@declutrmail/shared';
import { AccountMenu } from '@/features/mailboxes/account-menu';
import { useSenders } from '@/features/senders/api/use-senders';

/**
 * Authed app chrome. Wires the routing-agnostic AppShell to the
 * Next.js router — `active` from the path, `onNavigate` to `router.push`.
 *
 * Sender-count chip: derived from the live `useSenders` infinite query
 * (first page) — represents the active mailbox's count + a `+` suffix
 * when there's more data behind the cursor. Hidden until the first
 * page returns so we never flash a stale `0`.
 *
 * Account menu (D116 surface — partial): the topbar's right slot
 * carries the switcher / disconnect / connect-another / sign-out menu.
 * The menu reads `useAuth` so the AuthProvider must wrap this layout
 * (it does — see `apps/web/src/app/providers.tsx`).
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const active = pathname.split('/')[1] || 'senders';

  // First page is enough — the chip is a hint, not an inventory.
  const senders = useSenders({ limit: 50 });
  const firstPage = senders.data?.pages[0];
  const sendersCount =
    firstPage === undefined
      ? undefined
      : firstPage.meta.pagination.hasMore
        ? `${firstPage.data.length}+`
        : firstPage.data.length;

  return (
    <>
      <AppShell
        active={active}
        onNavigate={(id) => router.push(`/${id}`)}
        counts={sendersCount === undefined ? {} : { senders: sendersCount }}
        topbarRight={<AccountMenu />}
      >
        {children}
      </AppShell>
      <ToastHost />
    </>
  );
}
