/**
 * Tests for `SendersScreen` — the list screen wired to the live API.
 *
 * Covers the three first-class branches per D211/D212: loading,
 * error, and a populated list. The empty-mailbox branch (no senders
 * after a fetched-and-empty response) is also asserted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// The screen reads the active mailbox label via `useAuth`; stub it so the
// test renders without mounting the real AuthProvider (which fetches `me`).
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    me: {
      user: { id: 'u', email: 'me@example.com', workspaceId: 'w' },
      activeMailboxId: 'mb-1',
      mailboxes: [
        {
          id: 'mb-1',
          email: 'me@example.com',
          status: 'active',
          connectedAt: null,
          readiness: 'ready',
        },
      ],
    },
  }),
}));

import { SendersScreen } from './senders-screen';
import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { useSendersStore } from './store';

const ROW = {
  id: 'a',
  displayName: 'Sender A',
  email: 'a@example.com',
  domain: 'example.com',
  gmailCategory: 'promotions' as const,
  lastSeenAt: '2026-05-23T00:00:00.000Z',
  firstSeenAt: '2025-01-01T00:00:00.000Z',
  monthlyVolume: 30,
  readRate: 0,
  unsubscribeMethod: 'one_click' as const,
  protectionFlags: {
    isVip: false,
    isProtected: false,
    protectionReason: null,
    protectionSetAt: null,
  },
};

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <SendersScreen />
    </QueryWrapper>,
  );
}

/** Stock weekly-hero response (non-Monday, empty slices) — the bare
 * minimum the screen needs to render without errors. Per-test handlers
 * override this when the hero is what's under test. */
function weeklyHeroHandler(
  overrides: Partial<{ isMonday: boolean; slices: unknown[]; weekOf: string }> = {},
) {
  return {
    method: 'GET' as const,
    path: '/api/senders/weekly-hero',
    respond: () =>
      jsonOk({
        data: {
          isMonday: overrides.isMonday ?? false,
          weekOf: overrides.weekOf ?? '2026-05-25',
          slices: overrides.slices ?? [],
        },
      }),
  };
}

describe('SendersScreen — edge states', () => {
  beforeEach(() => {
    installFetchStub([weeklyHeroHandler()]);
    // Reset the per-session view to grid (D49 — default) so a prior
    // test that flipped the toggle doesn't leak into the next.
    useSendersStore.setState({ view: 'grid' });
  });
  afterEach(() => resetFetchStub());

  it('shows a loading skeleton while the initial fetch is in-flight', () => {
    // Handler that never resolves keeps the query in pending state.
    installFetchStub([
      weeklyHeroHandler(),
      {
        method: 'GET',
        path: '/api/senders',
        respond: () => new Promise<Response>(() => {}),
      },
    ]);

    renderScreen();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the error branch with a retry CTA on 500', async () => {
    installFetchStub([
      weeklyHeroHandler(),
      {
        method: 'GET',
        path: '/api/senders',
        respond: () => jsonServerError(),
      },
    ]);

    renderScreen();
    // Both the EmptyState heading and the body copy carry this phrase;
    // target the heading so the assertion is unambiguous.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /couldn[’']t load your senders/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('renders the empty-mailbox state when the API returns an empty page', async () => {
    installFetchStub([
      weeklyHeroHandler(),
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 25 } },
          }),
      },
    ]);

    renderScreen();
    await waitFor(() => expect(screen.getByText(/no senders yet/i)).toBeInTheDocument());
  });

  it('renders the editorial hero + KPI strip when the list resolves', async () => {
    // Two senders × monthlyVolume 30 = 60 emails reached you.
    // Variant D hero (per ADR-0011) frames the user's mailbox in
    // narrative form rather than the prior "N senders mail you" header.
    installFetchStub([
      weeklyHeroHandler(),
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [ROW, { ...ROW, id: 'b', displayName: 'Sender B' }],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 25 } },
          }),
      },
    ]);

    renderScreen();
    // Hero story line — "60 emails reached you." (totalMonthly = 60).
    // React renders the number inside a <span> so the text is split;
    // match the trailing plain text and assert the count separately.
    await waitFor(() => expect(screen.getByText(/emails reached you/i)).toBeInTheDocument());
    expect(screen.getByText('60')).toBeInTheDocument();
    // Breadcrumb names the active mailbox (D116) — not a static "default
    // mailbox" — so a multi-mailbox switch is visible.
    expect(screen.getByText(/Senders · me@example\.com/)).toBeInTheDocument();
    // Hero meta strip — reading time derived from totalMonthly.
    expect(screen.getByText(/Reading time \/ mo/i)).toBeInTheDocument();
    // KPI strip — "Noise reducible" is unique to the strip.
    expect(screen.getByText(/Noise reducible/i)).toBeInTheDocument();
    // Intent filter chips replaced the Gmail-category chips.
    expect(screen.getByRole('button', { name: /^All\b/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clean up/ })).toBeInTheDocument();
  });
});

/**
 * Weekly Hero (D47, D48) + grid/table toggle (D49). These tests
 * exercise the BE-driven Hero visibility branch and the per-session
 * view toggle.
 */
describe('SendersScreen — Weekly Hero (D47, D48) + view toggle (D49)', () => {
  beforeEach(() => {
    useSendersStore.setState({ view: 'grid' });
  });
  afterEach(() => resetFetchStub());

  const HERO_SLICE = {
    kind: 'high_confidence' as const,
    totalCount: 3,
    senders: [
      {
        id: 'a',
        displayName: 'Sender A',
        email: 'a@example.com',
        domain: 'example.com',
        monthlyVolume: 30,
        readRate: 0.05,
        sparkline: new Array<number>(12).fill(0),
      },
    ],
  };

  it('shows the Weekly Hero only when isMonday=true (D47)', async () => {
    installFetchStub([
      // Hero present on a Monday with at least one slice.
      {
        method: 'GET',
        path: '/api/senders/weekly-hero',
        respond: () =>
          jsonOk({
            data: { isMonday: true, weekOf: '2026-05-11', slices: [HERO_SLICE] },
          }),
      },
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [ROW],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 25 } },
          }),
      },
    ]);

    render(
      <QueryWrapper client={createTestQueryClient()}>
        <SendersScreen />
      </QueryWrapper>,
    );
    // The live Hero carries a stable `data-testid` for this kind of
    // visibility assertion — surface-not-text contract.
    await waitFor(() => expect(screen.getByTestId('weekly-hero-live')).toBeInTheDocument());
  });

  it('hides the Weekly Hero when isMonday=false (D47 — non-Monday branch)', async () => {
    installFetchStub([
      weeklyHeroHandler({ isMonday: false, slices: [HERO_SLICE] }),
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [ROW],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 25 } },
          }),
      },
    ]);

    render(
      <QueryWrapper client={createTestQueryClient()}>
        <SendersScreen />
      </QueryWrapper>,
    );
    // Wait for the senders list to settle, then assert the hero is absent.
    await waitFor(() => expect(screen.getByText(/emails reached you/i)).toBeInTheDocument());
    expect(screen.queryByTestId('weekly-hero-live')).not.toBeInTheDocument();
  });

  it('loads the next page when "Load more" is clicked (D202 cursor pagination)', async () => {
    const ROW_B = {
      ...ROW,
      id: 'page2',
      displayName: 'Second Page Sender',
      email: 'b@example.com',
    };
    installFetchStub([
      weeklyHeroHandler(),
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) =>
          url.searchParams.get('cursor')
            ? jsonOk({
                data: [ROW_B],
                meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
              })
            : jsonOk({
                data: [ROW],
                meta: { pagination: { nextCursor: 'cursor-1', hasMore: true, limit: 50 } },
              }),
      },
    ]);

    renderScreen();
    // Page 1 row present; page 2 row not yet fetched.
    await waitFor(() => expect(screen.getByText('Sender A')).toBeInTheDocument());
    expect(screen.queryByText('Second Page Sender')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /load more senders/i }));

    // Page 2 row appears AND page 1 stays (infinite query accumulates).
    await waitFor(() => expect(screen.getByText('Second Page Sender')).toBeInTheDocument());
    expect(screen.getByText('Sender A')).toBeInTheDocument();
  });

  it('does not render "Load more" when the first page is the last (hasMore=false)', async () => {
    installFetchStub([
      weeklyHeroHandler(),
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [ROW],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
          }),
      },
    ]);

    renderScreen();
    await waitFor(() => expect(screen.getByText('Sender A')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /load more senders/i })).not.toBeInTheDocument();
  });

  it('hides the Hero on Monday when every slice has < 3 senders (D48 empty-card guard)', async () => {
    installFetchStub([
      // BE responds with isMonday=true but slices=[] — the empty-card
      // guard already happened server-side.
      weeklyHeroHandler({ isMonday: true, slices: [] }),
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [ROW],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 25 } },
          }),
      },
    ]);

    render(
      <QueryWrapper client={createTestQueryClient()}>
        <SendersScreen />
      </QueryWrapper>,
    );
    await waitFor(() => expect(screen.getByText(/emails reached you/i)).toBeInTheDocument());
    expect(screen.queryByTestId('weekly-hero-live')).not.toBeInTheDocument();
  });

  it('defaults to grid view and flips to table when the toggle is clicked (D49)', async () => {
    installFetchStub([
      weeklyHeroHandler(),
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [ROW],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 25 } },
          }),
      },
    ]);

    render(
      <QueryWrapper client={createTestQueryClient()}>
        <SendersScreen />
      </QueryWrapper>,
    );
    // Default — grid is visible.
    await waitFor(() => expect(screen.getByTestId('sender-grid')).toBeInTheDocument());
    // Flip to table — find the segmented control's Table button.
    const tableBtn = screen.getByRole('button', { name: 'Table' });
    fireEvent.click(tableBtn);
    await waitFor(() => expect(useSendersStore.getState().view).toBe('table'));
    // After flipping, the grid is gone.
    expect(screen.queryByTestId('sender-grid')).not.toBeInTheDocument();
  });
});
