'use client';

/**
 * URL-backed "which sender is open in the side pane" — `?sender=<id>`.
 *
 * In the URL so the split view is shareable and the browser Back button
 * closes it. Opening PUSHES a history entry (Back closes the pane);
 * moving between senders and closing REPLACE it, so j/k does not bury
 * the list under one entry per row.
 *
 * `useComposeState` rewrites only its own keys, so `sender` survives a
 * filter or sort change.
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { senderDetailHref } from './sender-detail-navigation';

export const SENDER_PANE_PARAM = 'sender';

/**
 * Replaces the route change to `/senders/<id>` on narrow layouts. Unset in
 * the app. The public demo sets it to show the sender in place, because a
 * visitor has no session for that route.
 */
export const SenderPageNavigationContext = createContext<
  ((id: string, mode: 'push' | 'replace') => void) | null
>(null);

/** Vitest renders without an AppRouterContext — fall back to local state. */
function useOptionalAppRouter() {
  try {
    return { router: useRouter(), pathname: usePathname(), params: useSearchParams() };
  } catch {
    return null;
  }
}

export function useSenderPane(): {
  senderId: string | null;
  detailSearch: string;
  /** `push` for a fresh open; `replace` when the pane is already showing a sender. */
  open: (id: string) => void;
  close: () => void;
  /**
   * Leave the list for the full sender page (narrow layouts). `replace`
   * when redirecting a `?sender=` link — a pushed entry would trap Back.
   */
  navigateTo: (id: string, mode?: 'push' | 'replace') => void;
} {
  const appRouter = useOptionalAppRouter();
  const openInPlace = useContext(SenderPageNavigationContext);
  const [localId, setLocalId] = useState<string | null>(null);
  const urlId = appRouter?.params.get(SENDER_PANE_PARAM) ?? null;
  const senderId = appRouter ? urlId : localId;

  // The router hooks hand back fresh objects every render; reading them
  // through a ref keeps the callbacks below stable for effect deps.
  const latest = useRef({ appRouter, senderId, openInPlace });
  latest.current = { appRouter, senderId, openInPlace };

  const write = useCallback((id: string | null, mode: 'push' | 'replace') => {
    const { appRouter: r } = latest.current;
    if (!r) {
      setLocalId(id);
      return;
    }
    const out = new URLSearchParams(window.location.search);
    if (id === null) out.delete(SENDER_PANE_PARAM);
    else out.set(SENDER_PANE_PARAM, id);
    const qs = out.toString();
    // Selection is client state. Next's native-history integration updates
    // useSearchParams without rerunning the server's list/summary prefetch.
    window.history[mode === 'push' ? 'pushState' : 'replaceState'](
      null,
      '',
      `${r.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
    );
  }, []);

  const open = useCallback(
    (id: string) => {
      const current = latest.current.appRouter
        ? new URLSearchParams(window.location.search).get(SENDER_PANE_PARAM)
        : latest.current.senderId;
      write(id, current === null ? 'push' : 'replace');
    },
    [write],
  );
  const close = useCallback(() => write(null, 'replace'), [write]);
  const navigateTo = useCallback((id: string, mode: 'push' | 'replace' = 'push') => {
    if (latest.current.openInPlace) {
      latest.current.openInPlace(id, mode);
      return;
    }
    latest.current.appRouter?.router[mode](senderDetailHref(id, window.location.search));
  }, []);

  return { senderId, detailSearch: appRouter?.params.toString() ?? '', open, close, navigateTo };
}
