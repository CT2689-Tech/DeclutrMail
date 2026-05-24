'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell, ToastHost } from '@declutrmail/shared';
import { useSenders } from '@/features/senders/api/use-senders';

/**
 * Authed app chrome. Wires the routing-agnostic AppShell to the
 * Next.js router — `active` from the path, `onNavigate` to `router.push`.
 *
 * Sender-count chip: derived from the live `useSenders` infinite query
 * (first page). Before the wire-up PR this read `SENDERS.length` from
 * the demo fixture — a noticeable wart against a connected mailbox.
 * We show the first-page row count and append a `+` when
 * `hasMore=true`, because a true total would need either a dedicated
 * `/api/senders/stats` endpoint or eagerly paging the full list — both
 * disproportionate for a nav chip. When the stats endpoint lands, swap
 * this for a `useSenderStats` hook.
 *
 * Pre-fetch state (`isLoading`, no `data`) renders no count at all
 * rather than a `0` flash — the AppShell chip hides cleanly when the
 * `senders` count is undefined.
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
      >
        {children}
      </AppShell>
      <ToastHost />
    </>
  );
}
