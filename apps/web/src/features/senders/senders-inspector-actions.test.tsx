import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SenderDetailDto } from '@/lib/api/senders';
import { installFetchStub, jsonOk } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { SendersScreen } from './senders-screen';
import { useSendersStore } from './store';

vi.mock('next/navigation', () => ({
  useRouter: () => {
    throw new Error('Use the local navigation fallback in this test');
  },
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('./inspector-intent', () => ({ prefetchSenderInspector: vi.fn() }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ addBreadcrumb: vi.fn(), captureFeatureException: vi.fn() }));
vi.mock('@/features/auth/api/use-me', async (original) => ({
  ...(await original<object>()),
  useUserTimeZone: () => 'UTC',
}));
vi.mock('@/features/auth/auth-provider', () => {
  const useAuth = () => ({
    me: {
      user: { id: 'u', email: 'owner@example.com', workspaceId: 'w' },
      activeMailboxId: 'mb-1',
      tier: 'plus',
      cleanupRemaining: null,
      mailboxes: [{ id: 'mb-1', email: 'owner@example.com', status: 'active', readiness: 'ready' }],
    },
  });
  return { useAuth, useOptionalAuth: useAuth, getActiveMailboxEmail: () => 'owner@example.com' };
});

const A: SenderDetailDto = {
  id: 'a',
  displayName: 'Sender A',
  email: 'a@example.com',
  domain: 'example.com',
  brandMark: false,
  gmailCategory: 'promotions',
  lastSeenAt: '2025-01-01T00:00:00.000Z',
  firstSeenAt: '2024-01-01T00:00:00.000Z',
  monthlyVolume: 12,
  totalReceived: 12,
  inboxCount: 12,
  wroteToCount: 0,
  readRate: 0,
  volumeTrend: 'steady',
  unsubscribeMethod: 'none',
  lastReview: null,
  protectionFlags: { isProtected: false, protectionReason: null, protectionSetAt: null },
};
const B: SenderDetailDto = { ...A, id: 'b', displayName: 'Sender B', email: 'b@example.com' };
const pageMeta = { pagination: { nextCursor: null, hasMore: false, limit: 25 } };
const counts = {
  all: 12,
  olderThan30d: 12,
  olderThan90d: 12,
  olderThan180d: 12,
  olderThan365d: 12,
};
const recentMessages = {
  all: [],
  olderThan30d: [],
  olderThan90d: [],
  olderThan180d: [],
  olderThan365d: [],
};

let status: 'queued' | 'done';
let posted: unknown[];
let statusReads: number;
let originalMatchMedia: typeof window.matchMedia;

beforeEach(() => {
  status = 'queued';
  posted = [];
  statusReads = 0;
  useSendersStore.setState({ sort: 'total', direction: 'desc' });
  originalMatchMedia = window.matchMedia;
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  });
  installFetchStub([
    {
      method: 'GET',
      path: '/api/senders',
      respond: () => jsonOk({ data: [A, B], meta: pageMeta }),
    },
    {
      method: 'GET',
      path: /^\/api\/senders\/[ab]$/,
      respond: (_, url) => jsonOk({ data: url.pathname.endsWith('/a') ? A : B }),
    },
    {
      method: 'GET',
      path: /^\/api\/senders\/[ab]\/(messages|history)$/,
      respond: () => jsonOk({ data: [], meta: pageMeta }),
    },
    {
      method: 'GET',
      path: /^\/api\/senders\/[ab]\/timeseries$/,
      respond: () => jsonOk({ data: [] }),
    },
    {
      method: 'GET',
      path: '/api/me/settings',
      respond: () => jsonOk({ data: { senderViews: [] } }),
    },
    {
      method: 'GET',
      path: '/api/actions/preview',
      respond: () =>
        jsonOk({ data: { counts, recentMessages, protected: false, unsubAvailable: false } }),
    },
    {
      method: 'POST',
      path: '/api/actions',
      respond: async (req) => {
        posted.push(await req.json());
        return jsonOk({ data: { actionId: 'act-1', requestedCount: 12, status: 'queued' } });
      },
    },
    {
      method: 'GET',
      path: '/api/actions/act-1',
      respond: () => {
        statusReads += 1;
        return jsonOk({
          data: {
            actionId: 'act-1',
            verb: 'archive',
            direction: 'forward',
            status,
            requestedCount: 12,
            affectedCount: status === 'done' ? 12 : 0,
            wakeAt: null,
            undoToken: status === 'done' ? 'undo-1' : null,
            undoExpiresAt: status === 'done' ? '2027-01-01T00:00:00.000Z' : null,
            undoExecutedAt: null,
            undoRevertedAt: null,
            errorCode: null,
          },
        });
      },
    },
  ]);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function renderWorkspace() {
  const client = createTestQueryClient();
  render(
    <QueryWrapper client={client}>
      <SendersScreen />
    </QueryWrapper>,
  );
  return client;
}

async function openSender(name = 'Sender A') {
  fireEvent.click(await screen.findByRole('link', { name: new RegExp(`^${name}(,|$)`) }));
  const pane = await screen.findByTestId('sender-detail-pane', {}, { timeout: 10000 });
  await within(pane).findByRole('heading', { name, level: 2 });
  return within(pane);
}

async function confirmArchive() {
  const dialog = await screen.findByRole('dialog');
  const confirm = await within(dialog).findByRole('button', { name: 'Archive 12' });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('Senders list and inspector share action ownership', () => {
  it('keeps a pane action locked and polling when another sender replaces the pane', async () => {
    const client = renderWorkspace();
    const pane = await openSender();
    fireEvent.click(pane.getByRole('button', { name: 'Archive' }));
    await confirmArchive();

    const row = within(screen.getByTestId('sender-row-a'));
    await waitFor(() =>
      expect(row.getByRole('button', { name: 'More actions for Sender A' })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    );
    expect(pane.getByRole('button', { name: 'Delete' })).toHaveAttribute('aria-disabled', 'true');
    expect(posted).toHaveLength(1);

    await openSender('Sender B');
    const readsBefore = statusReads;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['action-status', 'act-1'] });
    });
    expect(statusReads).toBeGreaterThan(readsBefore);

    const reopened = await openSender();
    expect(reopened.getByRole('button', { name: 'Delete' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    status = 'done';
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['action-status', 'act-1'] });
    });
    await waitFor(() =>
      expect(row.getByRole('button', { name: 'More actions for Sender A' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    );
    expect(reopened.getByRole('button', { name: 'Delete' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(row.getByText(/Archived/)).toBeInTheDocument();
    expect(posted).toHaveLength(1);
  });

  it('makes list-originated pending work inert in the inspector too', async () => {
    renderWorkspace();
    const row = within(await screen.findByTestId('sender-row-a'));
    fireEvent.click(row.getByRole('button', { name: 'Archive' }));
    await confirmArchive();
    const pane = await openSender();
    expect(pane.getByRole('button', { name: 'Delete' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(pane.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posted).toHaveLength(1);
  });
});
