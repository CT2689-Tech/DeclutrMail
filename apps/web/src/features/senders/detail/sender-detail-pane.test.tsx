/**
 * `SenderDetailPane` — Sender Detail inside the Senders list's side pane.
 * Same content component as the full page (`SenderDetailRoute`), so these
 * cover only what the pane frame changes: its chrome, its heading level,
 * no key hints, and edge states that make sense beside a list.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SenderDetailPane } from './sender-detail-pane';
import type { SenderDetailDto } from '@/lib/api/senders';
import {
  installFetchStub,
  jsonNotFound,
  jsonOk,
  jsonServerError,
  resetFetchStub,
} from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const authState = vi.hoisted(() => ({
  me: {
    user: { id: 'user-1', email: 'owner@example.com', workspaceId: 'workspace-1' },
    mailboxes: [
      {
        id: 'mailbox-active',
        email: 'active@gmail.com',
        status: 'active' as const,
        connectedAt: '2026-01-01T00:00:00.000Z',
        readiness: 'ready' as const,
      },
    ],
    activeMailboxId: 'mailbox-active',
    tier: 'pro' as const,
    cleanupRemaining: null,
  },
}));
vi.mock('@/features/auth/auth-provider', () => ({
  getActiveMailboxEmail: () => 'active@gmail.com',
  useOptionalAuth: () => ({ me: authState.me }),
}));

const trackMock = vi.fn();
vi.mock('@/lib/posthog', () => ({ track: (...args: unknown[]) => trackMock(...args) }));
vi.mock('@/lib/sentry', () => ({ addBreadcrumb: vi.fn(), captureFeatureException: vi.fn() }));

const DETAIL: SenderDetailDto = {
  id: 'linkedin',
  displayName: 'LinkedIn',
  email: 'noreply@linkedin.com',
  domain: 'linkedin.com',
  brandMark: false,
  gmailCategory: 'social',
  lastSeenAt: '2026-05-23T00:00:00.000Z',
  firstSeenAt: '2023-05-23T00:00:00.000Z',
  monthlyVolume: 64,
  totalReceived: 2_048,
  wroteToCount: 0,
  readRate: 0.1,
  volumeTrend: 'steady',
  unsubscribeMethod: 'one_click',
  lastReview: null,
  protectionFlags: { isProtected: false, protectionReason: null, protectionSetAt: null },
};

const EMPTY_PAGE = {
  data: [],
  meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
};

function install(detail: () => Response) {
  installFetchStub([
    { method: 'GET', path: /^\/api\/senders\/[^/]+$/, respond: detail },
    {
      method: 'GET',
      path: /^\/api\/senders\/[^/]+\/(messages|history)$/,
      respond: () => jsonOk(EMPTY_PAGE),
    },
    {
      method: 'GET',
      path: /^\/api\/senders\/[^/]+\/timeseries$/,
      respond: () => jsonOk({ data: [{ yearMonth: '2026-04', volume: 20, readCount: 2 }] }),
    },
    {
      method: 'GET',
      path: '/api/actions/preview',
      respond: () =>
        jsonOk({
          data: {
            sender: {
              id: 'linkedin',
              name: 'LinkedIn',
              domain: 'linkedin.com',
              lastSeenDays: 2,
              wroteToCount: 0,
              monthly: 64,
            },
            counts: {
              all: 12,
              olderThan30d: 0,
              olderThan90d: 0,
              olderThan180d: 0,
              olderThan365d: 0,
            },
            recentMessages: {
              all: [],
              olderThan30d: [],
              olderThan90d: [],
              olderThan180d: [],
              olderThan365d: [],
            },
            unsubAvailable: true,
            protected: false,
          },
        }),
    },
  ]);
}

function renderPane(onClose = vi.fn(), senderId = 'linkedin') {
  render(
    <QueryWrapper client={createTestQueryClient()}>
      <SenderDetailPane senderId={senderId} onClose={onClose} />
    </QueryWrapper>,
  );
  return onClose;
}

describe('SenderDetailPane', () => {
  beforeEach(() => {
    trackMock.mockClear();
  });
  afterEach(() => {
    resetFetchStub();
  });

  it('renders the same detail content under pane chrome', async () => {
    install(() => jsonOk({ data: DETAIL }));
    const onClose = renderPane();

    const pane = within(screen.getByRole('complementary', { name: 'Sender details' }));
    // The list owns the page's h1 — the pane names the sender at h2.
    expect(await pane.findByRole('heading', { level: 2, name: 'LinkedIn' })).toBeInTheDocument();
    expect(pane.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(pane.getByTestId('sender-detail-window-count')).toHaveTextContent('64');
    expect(pane.getByTestId('sender-detail-inbox-count')).toHaveTextContent('—');
    expect(pane.getByRole('switch', { name: 'Protected' })).toBeInTheDocument();
    const actions = within(pane.getByRole('group', { name: 'Sender actions' }));
    for (const verb of ['Keep', 'Archive', 'Unsubscribe', 'Later', 'Delete']) {
      expect(actions.getByRole('button', { name: verb })).toBeInTheDocument();
      expect(pane.getAllByRole('button', { name: verb })).toHaveLength(1);
    }
    expect(pane.getByLabelText('Sender stats')).toBeInTheDocument();
    expect(pane.getByRole('region', { name: 'Recent messages' })).toBeInTheDocument();
    expect(pane.getByRole('heading', { name: 'Decision timeline' })).toBeInTheDocument();

    expect(pane.getByRole('link', { name: 'Open full page' })).toHaveAttribute(
      'href',
      '/senders/linkedin?from=senders_table',
    );
    fireEvent.click(pane.getByRole('button', { name: 'Close sender details' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps current inbox scope separate from received history', async () => {
    install(() => jsonOk({ data: { ...DETAIL, inboxCount: 12 } }));
    renderPane();
    await screen.findByRole('heading', { level: 2, name: 'LinkedIn' });
    expect(screen.getByTestId('sender-detail-inbox-count')).toHaveTextContent('12');
    expect(screen.getByTestId('sender-detail-window-count')).toHaveTextContent('64');
    expect(screen.getByText(/2,048 total/)).toBeInTheDocument();
  });

  it('advertises and binds no K/A/U/L/D key — the list owns those keys beside it', async () => {
    install(() => jsonOk({ data: DETAIL }));
    renderPane();

    await screen.findByRole('button', { name: 'Archive' });
    expect(screen.queryByRole('button', { name: /\([KAULD]\)/ })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'a' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // D226 — the preview is mandatory from the pane exactly as from the page.
  it.each(['Archive', 'Unsubscribe', 'Later', 'Delete'] as const)(
    '%s opens the preview before anything changes',
    async (verb) => {
      install(() => jsonOk({ data: DETAIL }));
      renderPane();

      fireEvent.click(await screen.findByRole('button', { name: verb }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    },
  );

  it('reports the list as the source of the open', async () => {
    install(() => jsonOk({ data: DETAIL }));
    renderPane();
    await waitFor(() =>
      expect(trackMock).toHaveBeenCalledWith('sender_detail_opened', {
        sender_id: 'linkedin',
        source: 'senders_table',
      }),
    );
  });

  it('shows a loading status inside the pane', () => {
    install(() => new Promise<Response>(() => {}) as unknown as Response);
    renderPane();
    const pane = within(screen.getByRole('complementary', { name: 'Sender details' }));
    expect(pane.getByRole('status')).toHaveTextContent('Loading sender details');
  });

  it('not found: closing the pane is the way back', async () => {
    install(() => jsonNotFound('sender_not_found'));
    const onClose = renderPane(vi.fn(), 'ghost');

    expect(await screen.findByText(/sender not found/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to Senders' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('load failure: offers a retry, and no link away from the list it sits beside', async () => {
    install(() => jsonServerError());
    renderPane();

    // The shared 1s + 2s + 4s backoff runs before the designed state shows.
    const alert = await screen.findByRole('alert', {}, { timeout: 10000 });
    expect(within(alert).getByRole('button', { name: /try again|retry/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to Senders' })).not.toBeInTheDocument();
  }, 15000);
});
