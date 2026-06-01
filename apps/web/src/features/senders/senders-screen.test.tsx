/**
 * Tests for `SendersScreen` — the list screen wired to the live API.
 *
 * Covers the three first-class branches per D211/D212: loading,
 * error, and a populated list. The empty-mailbox branch (no senders
 * after a fetched-and-empty response) is also asserted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
  totalReceived: 120,
  monthlyVolume: 30,
  readRate: 0,
  volumeTrend: 'steady' as const,
  unsubscribeMethod: 'one_click' as const,
  lastReview: null,
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

/** A populated /api/senders page with a single eligible sender (`ROW`). */
function oneSenderHandler() {
  return {
    method: 'GET' as const,
    path: '/api/senders',
    respond: () =>
      jsonOk({
        data: [ROW],
        meta: {
          pagination: { nextCursor: null, hasMore: false, limit: 25 },
          query: { totalMatching: 1, globalMaxTotal: 120, asOf: '2026-05-29T12:00:00.000Z' },
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
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              query: { totalMatching: 0, globalMaxTotal: 0, asOf: '2026-05-29T12:00:00.000Z' },
            },
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
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              query: { totalMatching: 0, globalMaxTotal: 0, asOf: '2026-05-29T12:00:00.000Z' },
            },
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

  it('routes a selection-scoped A shortcut through the D226 preview (D227)', async () => {
    installFetchStub([
      weeklyHeroHandler(),
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [ROW],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              query: { totalMatching: 1, globalMaxTotal: 120, asOf: '2026-05-29T12:00:00.000Z' },
            },
          }),
      },
    ]);

    renderScreen();
    // Select the sender so the bulk-action surface is live.
    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);

    // Pressing `A` opens the mandatory preview — never a direct mutation.
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(await screen.findByText(/archive all mail from 1 sender/i)).toBeInTheDocument();
  });

  it('archives a single sender for real (enqueue → poll → receipt → working undo) (D226, P6)', async () => {
    let archivePosted = false;
    let undoPosted = false;
    installFetchStub([
      weeklyHeroHandler(),
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [ROW],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              query: { totalMatching: 1, globalMaxTotal: 120, asOf: '2026-05-29T12:00:00.000Z' },
            },
          }),
      },
      {
        // Real inbox count for the preview (D226) — >0 so confirm enables.
        method: 'GET',
        path: '/api/actions/archive/preview',
        respond: () => jsonOk({ data: { senderId: 'a', inboxCount: 12 } }),
      },
      {
        method: 'POST',
        path: '/api/actions/archive',
        respond: () => {
          archivePosted = true;
          return jsonOk({ data: { actionId: 'act-1', requestedCount: 12, status: 'queued' } });
        },
      },
      {
        // Both the forward action (act-1) and the reverse job (rev-1) poll
        // here; the first poll already reports `done` so no timers needed.
        method: 'GET',
        path: /^\/api\/actions\/[^/]+$/,
        respond: (_req, url) =>
          jsonOk({
            data: {
              actionId: url.pathname.endsWith('rev-1') ? 'rev-1' : 'act-1',
              status: 'done',
              requestedCount: 12,
              affectedCount: 12,
              undoToken: url.pathname.endsWith('rev-1') ? null : 'tok-1',
              errorCode: null,
            },
          }),
      },
      {
        method: 'POST',
        path: '/api/undo/tok-1',
        respond: () => {
          undoPosted = true;
          return jsonOk({
            data: {
              token: 'tok-1',
              actionKind: 'archive',
              reverted: false,
              expired: false,
              revertedAt: null,
              actionId: 'rev-1',
            },
          });
        },
      },
    ]);

    renderScreen();
    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);

    // Intent → preview (mandatory, D226) → confirm via ⌘⏎.
    fireEvent.keyDown(document.body, { key: 'a' });
    await screen.findByText(/archive all mail from 1 sender/i);
    // Wait for the REAL inbox count to load so confirm is no longer gated.
    await screen.findByText(/in your inbox now/i);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    // The real endpoint was hit, and the REAL receipt appears only after the
    // worker reports `done` (never optimistically).
    const receipt = await screen.findByRole('status');
    expect(archivePosted).toBe(true);
    expect(receipt).toHaveTextContent(/archived 1 sender/i);
    const undoBtn = screen.getByRole('button', { name: /^undo$/i });

    // Undo reverses for real (token → reverse job → poll) and clears the receipt.
    fireEvent.click(undoBtn);
    await waitFor(() => expect(screen.queryByText(/archived 1 sender/i)).toBeNull());
    expect(undoPosted).toBe(true);
  });

  it('reports a no-op archive (0 affected at execution) with no reversible receipt (P6)', async () => {
    // Defense in depth: even if the preview counted >0, the inbox can empty
    // before the worker runs (a race), so the worker archives 0 and issues
    // no undo token. The screen must NOT show a "reversible" receipt with a
    // dead Undo (the dealskhoj.in class of bug).
    let statusPolled = false;
    installFetchStub([
      weeklyHeroHandler(),
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [ROW],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              query: { totalMatching: 1, globalMaxTotal: 120, asOf: '2026-05-29T12:00:00.000Z' },
            },
          }),
      },
      {
        // Preview counts >0 so confirm enables; the race empties it by execution.
        method: 'GET',
        path: '/api/actions/archive/preview',
        respond: () => jsonOk({ data: { senderId: 'a', inboxCount: 5 } }),
      },
      {
        method: 'POST',
        path: '/api/actions/archive',
        respond: () => jsonOk({ data: { actionId: 'act-0', requestedCount: 0, status: 'queued' } }),
      },
      {
        method: 'GET',
        path: /^\/api\/actions\/[^/]+$/,
        respond: () => {
          statusPolled = true;
          return jsonOk({
            data: {
              actionId: 'act-0',
              status: 'done',
              requestedCount: 0,
              affectedCount: 0,
              undoToken: null,
              errorCode: null,
            },
          });
        },
      },
    ]);

    renderScreen();
    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: 'a' });
    await screen.findByText(/archive all mail from 1 sender/i);
    await screen.findByText(/in your inbox now/i);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(statusPolled).toBe(true));
    // Let the terminal-status effect run, then assert no receipt was shown.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('disables Archive confirm when the sender has 0 mail in the inbox (D226)', async () => {
    // The real preview now gates the no-op UPFRONT: a 0 count tells the user
    // there's nothing to archive and blocks confirm, so they never enqueue
    // a no-op (the primary dealskhoj.in fix; the execution guard is backup).
    let archivePosted = false;
    installFetchStub([
      weeklyHeroHandler(),
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [ROW],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              query: { totalMatching: 1, globalMaxTotal: 120, asOf: '2026-05-29T12:00:00.000Z' },
            },
          }),
      },
      {
        method: 'GET',
        path: '/api/actions/archive/preview',
        respond: () => jsonOk({ data: { senderId: 'a', inboxCount: 0 } }),
      },
      {
        method: 'POST',
        path: '/api/actions/archive',
        respond: () => {
          archivePosted = true;
          return jsonOk({ data: { actionId: 'x', requestedCount: 0, status: 'queued' } });
        },
      },
    ]);

    renderScreen();
    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: 'a' });
    await screen.findByText(/archive all mail from 1 sender/i);

    // Preview resolves to 0 → "nothing to archive" + the confirm is disabled.
    await screen.findByText(/nothing to archive/i);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /archive/i })).toBeDisabled();

    // ⌘⏎ must NOT enqueue while gated.
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(archivePosted).toBe(false);
  });

  it('ignores the verb shortcut while a modal is already open', async () => {
    installFetchStub([
      weeklyHeroHandler(),
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [ROW],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              query: { totalMatching: 1, globalMaxTotal: 120, asOf: '2026-05-29T12:00:00.000Z' },
            },
          }),
      },
    ]);

    renderScreen();
    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: 'a' });
    await screen.findByText(/archive all mail from 1 sender/i);

    // A second verb key with the preview open must not stack a new modal.
    fireEvent.keyDown(document.body, { key: 'u' });
    expect(screen.queryByText(/unsubscribe from 1 sender/i)).toBeNull();
  });

  it('honors L and U shortcuts too (advertised aria-keyshortcuts are truthful)', async () => {
    installFetchStub([weeklyHeroHandler(), oneSenderHandler()]);
    renderScreen();

    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: 'l' });
    expect(await screen.findByText(/move 1 sender to later/i)).toBeInTheDocument();
    // Cancel the preview, then verify U routes to the unsubscribe preview.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText(/move 1 sender to later/i)).toBeNull());
    fireEvent.keyDown(document.body, { key: 'u' });
    expect(await screen.findByText(/unsubscribe from 1 sender/i)).toBeInTheDocument();
  });

  it('does not fire a verb shortcut while typing in the search field', async () => {
    installFetchStub([weeklyHeroHandler(), oneSenderHandler()]);
    renderScreen();

    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    const search = screen.getByRole('combobox', { name: /search senders/i });
    search.focus();
    fireEvent.keyDown(search, { key: 'a' });
    expect(screen.queryByText(/archive all mail from 1 sender/i)).toBeNull();
  });

  it('does not fire a verb shortcut while the cheatsheet is open', async () => {
    installFetchStub([weeklyHeroHandler(), oneSenderHandler()]);
    renderScreen();

    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: '?' }); // open cheatsheet
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(screen.queryByText(/archive all mail from 1 sender/i)).toBeNull();
  });

  it('does not stack the cheatsheet on top of an open preview', async () => {
    installFetchStub([weeklyHeroHandler(), oneSenderHandler()]);
    renderScreen();

    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: 'a' }); // open the preview
    await screen.findByText(/archive all mail from 1 sender/i);

    // `?` while the preview is open must not pop a second modal over it.
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('no-ops a verb shortcut when the selection has no eligible senders', async () => {
    // A standing-protected sender is ineligible for every bulk verb, so
    // the eligible filter is empty and no preview opens.
    const PROTECTED = {
      ...ROW,
      id: 'p',
      displayName: 'Protected Co',
      protectionFlags: { ...ROW.protectionFlags, isProtected: true, protectionReason: 'manual' },
    };
    installFetchStub([
      weeklyHeroHandler(),
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [PROTECTED],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              query: { totalMatching: 1, globalMaxTotal: 120, asOf: '2026-05-29T12:00:00.000Z' },
            },
          }),
      },
    ]);
    renderScreen();

    const checkbox = await screen.findByRole('checkbox', { name: /select protected co/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: 'u' });
    expect(screen.queryByText(/unsubscribe from/i)).toBeNull();
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
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              query: { totalMatching: 0, globalMaxTotal: 0, asOf: '2026-05-29T12:00:00.000Z' },
            },
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
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              query: { totalMatching: 0, globalMaxTotal: 0, asOf: '2026-05-29T12:00:00.000Z' },
            },
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
                meta: {
                  pagination: { nextCursor: null, hasMore: false, limit: 50 },
                  query: { totalMatching: 0, globalMaxTotal: 0, asOf: '2026-05-29T12:00:00.000Z' },
                },
              })
            : jsonOk({
                data: [ROW],
                meta: {
                  pagination: { nextCursor: 'cursor-1', hasMore: true, limit: 50 },
                  query: { totalMatching: 0, globalMaxTotal: 0, asOf: '2026-05-29T12:00:00.000Z' },
                },
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
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 50 },
              query: { totalMatching: 0, globalMaxTotal: 0, asOf: '2026-05-29T12:00:00.000Z' },
            },
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
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              query: { totalMatching: 0, globalMaxTotal: 0, asOf: '2026-05-29T12:00:00.000Z' },
            },
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
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              query: { totalMatching: 0, globalMaxTotal: 0, asOf: '2026-05-29T12:00:00.000Z' },
            },
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
