'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { QueryClientProvider, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ToastHost, toast, useIsAtMost } from '@declutrmail/shared';
import { WS3_COPY } from '@declutrmail/shared/copy/launch';
import { GROWTH_EVENT_NAMES } from '@declutrmail/shared/observability';

import { StaticAuthProvider } from '@/features/auth/auth-provider';
import { SendersScreen } from '@/features/senders/senders-screen';
import { SENDER_PANE_PARAM, SenderPageNavigationContext } from '@/features/senders/use-sender-pane';
import workspaceAppearance from '@/features/theme/workspace-appearance.module.css';
import { ProductUndoTray } from '@/features/triage/triage-undo-tray';
import { setApiTransport } from '@/lib/api/client';
import { setTrackGate, type TrackGate } from '@/lib/posthog';

import { createDemoBackend } from './demo-backend';
import { DEMO_MAILBOX_ID, DEMO_ME } from './demo-senders';
import './senders-demo.css';

/** App routes behind sign-in. A visitor has no session for them. */
const APP_ROUTES = [
  '/activity',
  '/admin',
  '/autopilot',
  '/billing',
  '/brief',
  '/followups',
  '/home',
  '/later',
  '/onboarding',
  '/quiet',
  '/screener',
  '/settings',
  '/triage',
];

// Only narrow layouts open a sender as a page.
const SenderDetailRoute = dynamic(
  () => import('@/features/senders/detail/sender-detail-page').then((m) => m.SenderDetailRoute),
  { ssr: false },
);

const APP_ONLY_TOAST = 'This opens in the app after you connect Gmail.';
const NO_GMAIL_TOAST = 'Sample inbox: there is no Gmail email to open.';

const PUBLIC_EVENTS: ReadonlySet<string> = new Set(GROWTH_EVENT_NAMES);

/**
 * The app screens report what a signed-in user does: a page view of
 * Senders, a confirmed action, an Undo. Here those are sample clicks, so
 * only the public site's own events pass: its CTAs, the demo events, and
 * this page's view.
 */
const allowPublicEventsOnly: TrackGate = (eventName, props) =>
  eventName === 'page_viewed'
    ? (props as { page?: unknown }).page === 'inbox_simulator'
    : PUBLIC_EVENTS.has(eventName);

/**
 * The demo's own cache, never the page's. Same freshness as the app's
 * client so the screen refetches when it does in the app. No retry: the
 * sample mailbox has no transient failures, and a request it cannot
 * answer should fail at once.
 *
 * The class comes from the page's client, not from an import. Importing
 * `QueryClient` (or `makeQueryClient`) into this lazy chunk makes the
 * bundler split a chunk that every route loads, which measured +0.5 kB on
 * each public page.
 */
function makeDemoQueryClient(pageClient: QueryClient): QueryClient {
  const Client = pageClient.constructor as new (
    config: ConstructorParameters<typeof QueryClient>[0],
  ) => QueryClient;
  return new Client({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false },
    },
  });
}

/** Write `?sender=` on the current page, leaving every other param alone. */
function writeSender(id: string | null, mode: 'push' | 'replace'): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get(SENDER_PANE_PARAM) === id) return;
  if (id === null) params.delete(SENDER_PANE_PARAM);
  else params.set(SENDER_PANE_PARAM, id);
  const query = params.toString();
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](
    null,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
  );
}

/**
 * The public Senders demo: the product's own `SendersScreen` over an
 * in-memory mailbox.
 *
 * Nothing here draws a sender, a filter or a preview. The screen, its
 * dialogs, the Undo bar and the toasts are the app's, so a change to any
 * of them shows up here with no demo edit. This component only supplies
 * what the app shell normally does: a query cache, an account, somewhere
 * for requests to go, and a way to stay on this page.
 */
export function SendersDemo() {
  const [backend] = useState(() => createDemoBackend());
  const pageClient = useQueryClient();
  const [queryClient] = useState(() => makeDemoQueryClient(pageClient));
  // Children fetch from their own effects, which run before this
  // component's. They mount only once requests have somewhere to go.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setApiTransport(backend.transport);
    setTrackGate(allowPublicEventsOnly);
    // A guided-review token from before a reload names a session that is gone.
    const params = new URLSearchParams(window.location.search);
    if (params.has('review')) {
      params.delete('review');
      const query = params.toString();
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
      );
    }
    setReady(true);
    return () => {
      setReady(false);
      setApiTransport(null);
      setTrackGate(null);
      queryClient.clear();
    };
  }, [backend, queryClient]);

  const narrow = useIsAtMost('shell');
  const urlSender = useSearchParams()?.get(SENDER_PANE_PARAM) ?? null;
  // Narrow layouts have no side pane; the app opens the sender's own page.
  const pageSender =
    narrow && urlSender !== null && backend.hasSender(urlSender) ? urlSender : null;

  /** Keep links to signed-in routes from leaving the demo. */
  const onLinkClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element).closest?.('a[href]');
    if (!anchor) return;
    const url = new URL(anchor.getAttribute('href') ?? '', window.location.href);
    if (url.protocol === 'mailto:' || url.hostname === 'mail.google.com') {
      event.preventDefault();
      toast(NO_GMAIL_TOAST, 'info');
      return;
    }
    if (url.origin !== window.location.origin) return;
    const sender = /^\/senders\/([^/]+)$/.exec(url.pathname);
    if (sender) {
      event.preventDefault();
      const id = decodeURIComponent(sender[1]!);
      if (urlSender === id) toast(APP_ONLY_TOAST, 'info');
      else writeSender(id, 'push');
    } else if (url.pathname === '/senders') {
      event.preventDefault();
      writeSender(null, 'replace');
    } else if (
      APP_ROUTES.some((route) => url.pathname === route || url.pathname.startsWith(`${route}/`))
    ) {
      event.preventDefault();
      toast(APP_ONLY_TOAST, 'info');
    }
  };

  return (
    <div className="dm-senders-demo" onClickCapture={onLinkClick}>
      <div className="dm-senders-demo-note">{WS3_COPY['ws3.demo.senders.note']}</div>
      {ready ? (
        <QueryClientProvider client={queryClient}>
          <StaticAuthProvider me={DEMO_ME}>
            <SenderPageNavigationContext.Provider value={writeSender}>
              <div className={workspaceAppearance.content} data-workspace-appearance="">
                {pageSender !== null && <SenderDetailRoute key={pageSender} id={pageSender} />}
                {/* Kept mounted so a running action keeps its owner. */}
                <div hidden={pageSender !== null}>
                  <SendersScreen active={pageSender === null} />
                </div>
              </div>
              <ProductUndoTray
                mailboxId={DEMO_MAILBOX_ID}
                onViewActivity={() => toast(APP_ONLY_TOAST, 'info')}
              />
              <ToastHost />
            </SenderPageNavigationContext.Provider>
          </StaticAuthProvider>
        </QueryClientProvider>
      ) : null}
    </div>
  );
}
