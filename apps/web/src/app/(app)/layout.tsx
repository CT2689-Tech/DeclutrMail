'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell, ToastHost } from '@declutrmail/shared';
import { useAuth } from '@/features/auth/auth-provider';
import { AccountMenu } from '@/features/mailboxes/account-menu';
import { NoActiveMailbox } from '@/features/mailboxes/no-active-mailbox';
import { useMailboxSyncToasts } from '@/features/mailboxes/use-mailbox-sync-toasts';
import { useSenders } from '@/features/senders/api/use-senders';
import { SyncNowAnimationStyle, SyncNowButton } from '@/features/sync/sync-now-button';

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
  const { me } = useAuth();
  const active = pathname.split('/')[1] || 'senders';
  const hasActiveMailbox = me.activeMailboxId != null;

  // In-app "B is ready" toast when a background sync finishes (D116).
  useMailboxSyncToasts();

  // First page is enough — the chip is a hint, not an inventory. Gated
  // off when there's no active mailbox so it can't 409.
  const senders = useSenders({ limit: 50, enabled: hasActiveMailbox });
  const firstPage = senders.data?.pages[0];
  const sendersCount =
    firstPage === undefined
      ? undefined
      : firstPage.meta.pagination.hasMore
        ? `${firstPage.data.length}+`
        : firstPage.data.length;

  // No active mailbox (last one disconnected) — take over with the
  // reconnect gate instead of rendering a broken, data-less shell.
  if (!hasActiveMailbox) {
    return (
      <>
        <NoActiveMailbox />
        <ToastHost />
      </>
    );
  }

  return (
    <>
      <SyncNowAnimationStyle />
      <AppShell
        active={active}
        onNavigate={(id) => router.push(`/${id}`)}
        counts={sendersCount === undefined ? {} : { senders: sendersCount }}
        topbarRight={
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <SyncNowButton />
            <AccountMenu />
          </div>
        }
      >
        {children}
      </AppShell>
      <ToastHost />
    </>
  );
}
