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

import { ToastHost } from '@declutrmail/shared';
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

function archiveStatus(
  overrides: Partial<{
    actionId: string;
    status: 'queued' | 'executing' | 'done' | 'failed';
    requestedCount: number;
    affectedCount: number;
    undoToken: string | null;
    undoExpiresAt: string | null;
    errorCode: string | null;
  }> = {},
) {
  return {
    actionId: 'act-1',
    verb: 'archive',
    direction: 'forward',
    status: 'done',
    requestedCount: 12,
    affectedCount: 12,
    wakeAt: null,
    undoToken: 'tok-1',
    undoExpiresAt: '2027-06-16T14:35:00.000Z',
    undoExecutedAt: null,
    undoRevertedAt: null,
    errorCode: null,
    ...overrides,
  };
}

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <SendersScreen />
    </QueryWrapper>,
  );
}

/** Like `renderScreen`, with the shared `ToastHost` mounted so tests can
 * assert toast copy (the app layout mounts it at the root). */
function renderScreenWithToasts() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <SendersScreen />
      <ToastHost />
    </QueryWrapper>,
  );
}

/**
 * Stock /api/senders/summary response (#145, real-data counts). Defaults
 * match a small, single-sender mailbox so tests that don't care about
 * the summary don't need to override; per-test overrides shape the
 * aggregates when the summary IS what's under test.
 */
function sendersSummaryHandler(
  overrides: Partial<{
    totalSenders: number;
    activeSenders: number;
    last30dVolume: number;
    noiseReducible: number;
    protected: number;
    needsReview: number;
    byBucket: {
      one_time: number;
      protect: number;
      people: number;
      needs_review: number;
      quiet: number;
      dormant: number;
      bulk: number;
      other: number;
    };
    qCapture: { value: string | null };
  }> = {},
) {
  return {
    method: 'GET' as const,
    path: '/api/senders/summary',
    respond: (_req: Request, url: URL) => {
      if (overrides.qCapture) overrides.qCapture.value = url.searchParams.get('q');
      return jsonOk({
        data: {
          totalSenders: overrides.totalSenders ?? 1,
          activeSenders: overrides.activeSenders ?? 1,
          last30dVolume: overrides.last30dVolume ?? 30,
          noiseReducible: overrides.noiseReducible ?? 0,
          protected: overrides.protected ?? 0,
          needsReview: overrides.needsReview ?? 0,
          byBucket: overrides.byBucket ?? {
            one_time: 0,
            protect: 0,
            people: 0,
            needs_review: 0,
            quiet: 0,
            dormant: 0,
            bulk: 0,
            other: 1,
          },
          asOf: '2026-06-01T00:00:00.000Z',
        },
      });
    },
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
    installFetchStub([]);
    // Reset the per-session view to grid (D49 — default) so a prior
    // test that flipped the toggle doesn't leak into the next.
    useSendersStore.setState({ view: 'grid' });
  });
  afterEach(() => resetFetchStub());

  it('shows a loading skeleton while the initial fetch is in-flight', () => {
    // Handler that never resolves keeps the query in pending state.
    installFetchStub([
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

  it('searches server-side — finds a sender that is NOT on the first page (#145)', async () => {
    // The founder's bug: searching "dealskhoj" returned nothing because the
    // FE filtered only the loaded ≤50-row page. With server-side search the
    // term goes to the BE, which returns the match even though it isn't on
    // page 1. The stub returns the dealskhoj sender ONLY when ?q=dealskhoj —
    // so its appearance proves the term reached the server.
    const DEALS_ROW = {
      ...ROW,
      id: 'deals',
      displayName: 'Exclusive Deals',
      email: 'emailer@dealskhoj.in',
      domain: 'dealskhoj.in',
    };
    let lastQ: string | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) => {
          lastQ = url.searchParams.get('q');
          const match = lastQ === 'dealskhoj';
          return jsonOk({
            data: match ? [DEALS_ROW] : [ROW],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 50 },
              query: { totalMatching: 1, globalMaxTotal: 120, asOf: '2026-05-29T12:00:00.000Z' },
            },
          });
        },
      },
    ]);

    renderScreen();
    // Initial page (no q) shows Sender A; dealskhoj is not on it.
    await screen.findAllByText(/Sender A/);
    expect(screen.queryByText(/Exclusive Deals/)).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: /search senders/i }), {
      target: { value: 'dealskhoj' },
    });

    // After the debounce, the server gets q and returns the off-page match.
    await waitFor(() => expect(screen.getAllByText(/Exclusive Deals/).length).toBeGreaterThan(0), {
      timeout: 2000,
    });
    expect(lastQ).toBe('dealskhoj');
  });

  it('shows the server snapshot time and mailbox scope beside sender counts', async () => {
    installFetchStub([oneSenderHandler(), sendersSummaryHandler()]);

    renderScreen();

    await screen.findAllByText(/Sender A/);
    const freshness = screen.getByTestId('sender-results-freshness');
    expect(freshness).toHaveTextContent(/matching count and rows for me@example\.com/i);
    expect(freshness).toHaveTextContent(/snapshot/i);
    expect(
      freshness.querySelector('time[datetime="2026-05-29T12:00:00.000Z"]'),
    ).toBeInTheDocument();
    // One responsive line serves both desktop and mobile; it wraps instead
    // of being hidden behind either view's layout breakpoint.
    expect(freshness).toHaveStyle({ display: 'flex', flexWrap: 'wrap' });
  });

  it('makes placeholder rows read-only and announces the query transition', async () => {
    const FILTERED_ROW = {
      ...ROW,
      id: 'filtered',
      displayName: 'Filtered Sender',
      email: 'filtered@example.com',
    };
    let resolveFiltered: ((response: Response) => void) | null = null;
    const filteredResponse = new Promise<Response>((resolve) => {
      resolveFiltered = resolve;
    });

    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) => {
          if (url.searchParams.get('q') === 'filtered') return filteredResponse;
          return jsonOk({
            data: [ROW],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 50 },
              query: {
                totalMatching: 1,
                globalMaxTotal: 120,
                asOf: '2026-05-29T12:00:00.000Z',
              },
            },
          });
        },
      },
      sendersSummaryHandler(),
    ]);

    renderScreen();
    const oldCheckbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(oldCheckbox);
    expect(screen.getByText(/sender selected/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: /search senders/i }), {
      target: { value: 'filtered' },
    });

    expect(await screen.findByText('Updating results…', {}, { timeout: 2000 })).toBeInTheDocument();
    const region = screen.getByTestId('sender-results-region');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveAttribute('aria-disabled', 'true');
    expect(region).toHaveAttribute('inert');
    expect(region).toHaveStyle({ opacity: '0.55', pointerEvents: 'none' });
    expect(oldCheckbox).toBeDisabled();
    await waitFor(() => expect(oldCheckbox).not.toBeChecked());
    await waitFor(() => expect(screen.queryByText(/sender selected/i)).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Even a synthetic shortcut cannot act on the retained prior rows.
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => {
      resolveFiltered?.(
        jsonOk({
          data: [FILTERED_ROW],
          meta: {
            pagination: { nextCursor: null, hasMore: false, limit: 50 },
            query: {
              totalMatching: 1,
              globalMaxTotal: 120,
              asOf: '2026-06-02T09:30:00.000Z',
            },
          },
        }),
      );
    });

    expect(await screen.findAllByText(/Filtered Sender/)).not.toHaveLength(0);
    await waitFor(() => expect(region).toHaveAttribute('aria-busy', 'false'));
    const freshCheckbox = screen.getByRole('checkbox', { name: /select filtered sender/i });
    expect(freshCheckbox).not.toBeDisabled();
    expect(screen.queryByText('Updating results…')).not.toBeInTheDocument();
    expect(
      screen
        .getByTestId('sender-results-freshness')
        .querySelector('time[datetime="2026-06-02T09:30:00.000Z"]'),
    ).toBeInTheDocument();
  });

  it('narrows the list server-side when the "you replied" chip is toggled (D38)', async () => {
    // Regression: the chip wrote URL state and the BE accepted ?replied=,
    // but the FE never sent it — a silent no-op. The stub returns the
    // replied-to sender ONLY when ?replied=true, so its appearance proves
    // the param reached the server (and the row set actually narrowed).
    const REPLIED_ROW = {
      ...ROW,
      id: 'replied',
      displayName: 'Replied Sender',
      email: 'friend@replied.example',
      domain: 'replied.example',
    };
    let lastReplied: string | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) => {
          lastReplied = url.searchParams.get('replied');
          const match = lastReplied === 'true';
          return jsonOk({
            data: match ? [REPLIED_ROW] : [ROW, REPLIED_ROW],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 50 },
              query: {
                totalMatching: match ? 1 : 2,
                globalMaxTotal: 120,
                asOf: '2026-05-29T12:00:00.000Z',
              },
            },
          });
        },
      },
    ]);

    renderScreen();
    // Unfiltered page shows both senders.
    await screen.findAllByText(/Sender A/);
    expect(screen.getAllByText(/Replied Sender/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /you replied/i }));

    // The refetch carries replied=true and the non-replied sender drops out.
    await waitFor(() => expect(screen.queryByText(/Sender A/)).toBeNull(), { timeout: 2000 });
    expect(screen.getAllByText(/Replied Sender/).length).toBeGreaterThan(0);
    expect(lastReplied).toBe('true');
  });

  it('routes a selection-scoped A shortcut through the D226 preview (D227)', async () => {
    installFetchStub([
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
    expect(await screen.findByText(/archive mail from 1 sender/i)).toBeInTheDocument();
  });

  it('archives a single sender for real (enqueue → poll → receipt → working undo) (D226, P6)', async () => {
    let archivePosted = false;
    let undoPosted = false;
    installFetchStub([
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
            data: archiveStatus({
              actionId: url.pathname.endsWith('rev-1') ? 'rev-1' : 'act-1',
              undoToken: url.pathname.endsWith('rev-1') ? null : 'tok-1',
              undoExpiresAt: url.pathname.endsWith('rev-1') ? null : '2027-06-16T14:35:00.000Z',
            }),
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
    await screen.findByText(/archive mail from 1 sender/i);
    // Wait for the REAL inbox count to load so confirm is no longer gated.
    await screen.findByText(/in your inbox now/i);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    // The real endpoint was hit, and the REAL receipt appears only after the
    // worker reports `done` (never optimistically).
    const receipt = await screen.findByRole('status');
    expect(archivePosted).toBe(true);
    expect(receipt).toHaveTextContent(/archived/i);
    expect(receipt).toHaveTextContent(/1 sender/i);
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
            data: archiveStatus({
              actionId: 'act-0',
              requestedCount: 0,
              affectedCount: 0,
              undoToken: null,
              undoExpiresAt: null,
            }),
          });
        },
      },
    ]);

    renderScreen();
    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: 'a' });
    await screen.findByText(/archive mail from 1 sender/i);
    await screen.findByText(/in your inbox now/i);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(statusPolled).toBe(true));
    // The canonical result preserves the no-op, but never offers a dead Undo.
    const noOp = await screen.findByRole('status');
    expect(noOp).toHaveTextContent(/no matching inbox mail moved/i);
    expect(screen.queryByRole('button', { name: /^undo$/i })).toBeNull();
  });

  it('disables Archive confirm when the sender has 0 mail in the inbox (D226)', async () => {
    // The real preview now gates the no-op UPFRONT: a 0 count tells the user
    // there's nothing to archive and blocks confirm, so they never enqueue
    // a no-op (the primary dealskhoj.in fix; the execution guard is backup).
    let archivePosted = false;
    installFetchStub([
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
    await screen.findByText(/archive mail from 1 sender/i);

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

  it('blocks Archive and offers retry when the live preview fails', async () => {
    // A failed count check must say so honestly, never fall back to a
    // historic estimate, and never let a mail-changing action proceed.
    let archivePosted = false;
    let previewRequests = 0;
    installFetchStub([
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
        respond: () => {
          previewRequests++;
          return jsonServerError();
        },
      },
      {
        method: 'POST',
        path: '/api/actions/archive',
        respond: () => {
          archivePosted = true;
          return jsonOk({ data: { actionId: 'act-1', requestedCount: 3, status: 'queued' } });
        },
      },
      {
        method: 'GET',
        path: /^\/api\/actions\/[^/]+$/,
        respond: () =>
          jsonOk({
            data: archiveStatus({ requestedCount: 3, affectedCount: 3 }),
          }),
      },
    ]);

    renderScreen();
    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: 'a' });
    await screen.findByText(/archive mail from 1 sender/i);

    // Count check failed → explicit no-change state and a blocked confirm.
    await screen.findByText(/preview unavailable/i);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /archive/i })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: /retry preview/i }));
    await waitFor(() => expect(previewRequests).toBeGreaterThan(1));

    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(archivePosted).toBe(false);
  });

  it('Unsubscribe with 0 inbox mail hides the "also archive" toggle but still confirms (D226)', async () => {
    // The bug: Unsubscribe offered (and pre-checked) "also archive everything
    // currently in the inbox" using the LIFETIME total, with no idea the inbox
    // held nothing — contradicting the Archive preview's "nothing to archive"
    // for the same sender. The real inbox count must gate the toggle. But
    // Unsubscribe is future-only, so a 0 count must NOT block its confirm.
    installFetchStub([
      oneSenderHandler(),
      {
        method: 'GET',
        path: '/api/actions/archive/preview',
        respond: () => jsonOk({ data: { senderId: 'a', inboxCount: 0 } }),
      },
    ]);

    renderScreen();
    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: 'u' });
    await screen.findByText(/unsubscribe from 1 sender/i);

    // Once the count resolves to 0, the backlog toggle disappears — no offer
    // to archive mail that isn't there.
    await waitFor(() => expect(screen.queryByText(/currently in the inbox/i)).toBeNull());
    // ...and the confirm stays enabled (unsubscribe stops FUTURE mail; an empty
    // inbox doesn't make it a no-op the way it does for Archive).
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /unsubscribe/i })).not.toBeDisabled();
  });

  it('Unsubscribe surfaces the composite secondary chip row (spec v1.2 Decision 15)', async () => {
    // PR-FE3 replaced the boolean "Also archive the N emails currently in
    // the inbox" toggle with a chip row [Leave alone | Archive them |
    // Delete them]. The default is "Leave alone" (Unsubscribe stays
    // non-destructive against past mail by default); the user can opt
    // into Archive/Delete past via the chip row, which surfaces the
    // time-window chip row underneath when active.
    installFetchStub([
      oneSenderHandler(),
      {
        method: 'GET',
        path: '/api/actions/archive/preview',
        respond: () => jsonOk({ data: { senderId: 'a', inboxCount: 3 } }),
      },
    ]);

    renderScreen();
    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: 'u' });
    await screen.findByText(/unsubscribe from 1 sender/i);

    // The secondary chip row group label + chip options appear.
    await screen.findByRole('radiogroup', { name: /also act on past emails/i });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: /leave alone/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /archive them/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /delete them/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /unsubscribe/i })).not.toBeDisabled();
  });

  it('never advertises more sample subjects than the real total in "Show what will move" (live smoke 2026-06-09)', async () => {
    // The disclosure used to hardcode "(5 of N)" — a sender with 3 mails
    // rendered "Show what will move (5 of 3)". The label must read the
    // ACTUAL sample length, trimmed to the bucket total, even when the
    // wire returns more subjects than the count (drift defense).
    installFetchStub([
      oneSenderHandler(),
      {
        method: 'GET',
        path: '/api/actions/archive/preview',
        respond: () => jsonOk({ data: { senderId: 'a', inboxCount: 3 } }),
      },
      {
        method: 'GET',
        path: '/api/actions/preview',
        respond: () =>
          jsonOk({
            data: {
              sender: {
                id: 'a',
                name: 'Sender A',
                domain: 'example.com',
                lastSeenDays: 2,
                repliedCount: 0,
                monthly: 3,
              },
              counts: {
                all: 3,
                olderThan30d: 0,
                olderThan90d: 0,
                olderThan180d: 0,
                olderThan365d: 0,
              },
              recentSubjects: {
                // 5 subjects against a count of 3 — deliberate drift.
                all: [
                  'Subject one',
                  'Subject two',
                  'Subject three',
                  'Subject four',
                  'Subject five',
                ],
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

    renderScreen();
    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: 'a' });
    await screen.findByText(/archive mail from 1 sender/i);

    // X = sample rows actually shown, Y = the real total; X <= Y always.
    const disclosure = await screen.findByText(/show what will move \(3 of 3\)/i);
    fireEvent.click(disclosure);
    expect(screen.getByText('Subject one')).toBeInTheDocument();
    expect(screen.getByText('Subject three')).toBeInTheDocument();
    expect(screen.queryByText('Subject four')).toBeNull();
    expect(screen.queryByText('Subject five')).toBeNull();
  });

  it('ignores the verb shortcut while a modal is already open', async () => {
    installFetchStub([
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
    await screen.findByText(/archive mail from 1 sender/i);

    // A second verb key with the preview open must not stack a new modal.
    fireEvent.keyDown(document.body, { key: 'u' });
    expect(screen.queryByText(/unsubscribe from 1 sender/i)).toBeNull();
  });

  it('honors L and U shortcuts too (advertised aria-keyshortcuts are truthful)', async () => {
    installFetchStub([oneSenderHandler()]);
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
    installFetchStub([oneSenderHandler()]);
    renderScreen();

    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    const search = screen.getByRole('combobox', { name: /search senders/i });
    search.focus();
    fireEvent.keyDown(search, { key: 'a' });
    expect(screen.queryByText(/archive mail from 1 sender/i)).toBeNull();
  });

  it('does not fire a verb shortcut while the cheatsheet is open', async () => {
    installFetchStub([oneSenderHandler()]);
    renderScreen();

    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: '?' }); // open cheatsheet
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(screen.queryByText(/archive mail from 1 sender/i)).toBeNull();
  });

  it('does not stack the cheatsheet on top of an open preview', async () => {
    installFetchStub([oneSenderHandler()]);
    renderScreen();

    const checkbox = await screen.findByRole('checkbox', { name: /select sender a/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: 'a' }); // open the preview
    await screen.findByText(/archive mail from 1 sender/i);

    // `?` while the preview is open must not pop a second modal over it.
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('explains why instead of opening a preview when no selected sender is eligible (D226)', async () => {
    // A standing-protected sender is ineligible for every bulk verb, so
    // the eligible filter is empty. No preview opens — but the verb
    // press must not be a SILENT no-op: a toast says why.
    const PROTECTED = {
      ...ROW,
      id: 'p',
      displayName: 'Protected Co',
      protectionFlags: { ...ROW.protectionFlags, isProtected: true, protectionReason: 'manual' },
    };
    installFetchStub([
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
    renderScreenWithToasts();

    const checkbox = await screen.findByRole('checkbox', { name: /select protected co/i });
    fireEvent.click(checkbox);
    fireEvent.keyDown(document.body, { key: 'u' });
    expect(screen.queryByText(/unsubscribe from/i)).toBeNull();
    expect(
      await screen.findByText(/protected co is protected — unprotect it first/i),
    ).toBeInTheDocument();
  });
});

/**
 * Multi-sender bulk actions (D52, D32). The selection-bar A/L/D verbs
 * ride the real pipeline: aggregated D226 preview → one bulk enqueue
 * (per-sender fan-out server-side) → batch poll → real receipt + undo.
 * Selection clears ONLY on server confirmation; nothing is fabricated.
 */
describe('SendersScreen — multi-sender bulk actions (D52)', () => {
  beforeEach(() => {
    useSendersStore.setState({ view: 'grid', sort: 'total', direction: 'desc' });
  });
  afterEach(() => resetFetchStub());

  const ROW_B = { ...ROW, id: 'b', displayName: 'Sender B', email: 'b@example.com' };

  const TWO_SENDER_LIST = {
    method: 'GET' as const,
    path: '/api/senders',
    respond: () =>
      jsonOk({
        data: [ROW, ROW_B],
        meta: {
          pagination: { nextCursor: null, hasMore: false, limit: 25 },
          query: { totalMatching: 2, globalMaxTotal: 120, asOf: '2026-05-29T12:00:00.000Z' },
        },
      }),
  };

  const BULK_PREVIEW_OK = {
    method: 'POST' as const,
    path: '/api/actions/preview/bulk',
    respond: () =>
      jsonOk({
        data: {
          senders: [
            {
              senderId: 'a',
              name: 'Sender A',
              counts: {
                all: 12,
                olderThan30d: 8,
                olderThan90d: 5,
                olderThan180d: 3,
                olderThan365d: 1,
              },
              protected: false,
            },
            {
              senderId: 'b',
              name: 'Sender B',
              counts: {
                all: 18,
                olderThan30d: 9,
                olderThan90d: 6,
                olderThan180d: 4,
                olderThan365d: 2,
              },
              protected: false,
            },
          ],
          totals: {
            all: 30,
            olderThan30d: 17,
            olderThan90d: 11,
            olderThan180d: 7,
            olderThan365d: 3,
          },
          protectedCount: 0,
        },
      }),
  };

  /** Select both senders and open the bulk preview for `key`. */
  async function selectBothAndPress(key: string) {
    fireEvent.click(await screen.findByRole('checkbox', { name: /select sender a/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select sender b/i }));
    fireEvent.keyDown(document.body, { key });
  }

  it('qualifies bulk selection as the currently loaded rows', async () => {
    installFetchStub([TWO_SENDER_LIST]);
    renderScreen();

    const selectLoaded = await screen.findByRole('button', { name: /select loaded 2/i });
    fireEvent.click(selectLoaded);
    expect(screen.getByRole('button', { name: /deselect loaded 2/i })).toBeInTheDocument();
  });

  it('bulk-archives a selection for real (aggregated preview → enqueue → batch poll → receipt → undo)', async () => {
    let bulkBody: unknown = null;
    let undoPosted = false;
    installFetchStub([
      TWO_SENDER_LIST,
      BULK_PREVIEW_OK,
      {
        method: 'POST',
        path: '/api/actions',
        respond: async (req) => {
          bulkBody = await req.json();
          return jsonOk({
            data: {
              batchId: 'batch-1',
              status: 'queued',
              senderCount: 2,
              requestedTotal: 30,
              skipped: [],
            },
          });
        },
      },
      {
        method: 'GET',
        path: /^\/api\/actions\/batch\/[^/]+$/,
        respond: () =>
          jsonOk({
            data: {
              batchId: 'batch-1',
              status: 'done',
              total: 2,
              done: 2,
              failed: 0,
              requestedCount: 30,
              affectedCount: 30,
              undoToken: 'tok-b',
            },
          }),
      },
      {
        // The undo's reverse job polls the single-action route.
        method: 'GET',
        path: /^\/api\/actions\/[^/]+$/,
        respond: () =>
          jsonOk({
            data: {
              actionId: 'rev-1',
              status: 'done',
              requestedCount: 30,
              affectedCount: 30,
              undoToken: null,
              errorCode: null,
            },
          }),
      },
      {
        method: 'POST',
        path: '/api/undo/tok-b',
        respond: () => {
          undoPosted = true;
          return jsonOk({
            data: {
              token: 'tok-b',
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
    await selectBothAndPress('a');
    // Mandatory D226 preview with the AGGREGATED real count (never the
    // fabricated tracer numbers).
    await screen.findByText(/archive mail from 2 senders/i);
    await screen.findByText(/will move to Archive/i);
    // The aggregated total (12 + 18) renders in the modal — headline +
    // the "All inbox" chip count both read 30.
    expect(within(screen.getByRole('dialog')).getAllByText('30').length).toBeGreaterThan(0);
    // Per-window chips read the AGGREGATED totals too (8 + 9 = 17 for
    // "30 days+") — never the single-sender composite preview, which is
    // absent on bulk flows.
    expect(
      within(screen.getByRole('dialog')).getByRole('radio', { name: /30 days\+/i }),
    ).toHaveTextContent('17');
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    // Real receipt appears only after the batch poll reports done.
    const receipt = await screen.findByRole('status');
    expect(receipt).toHaveTextContent(/archived/i);
    expect(receipt).toHaveTextContent(/30 emails/i);
    expect(receipt).toHaveTextContent(/2 senders/i);
    expect(receipt).toHaveTextContent(/2 selected · 2 accepted · 0 skipped/i);
    // Wire shape — ONE bulk POST carrying the senders selector.
    expect(bulkBody).toMatchObject({
      selector: { type: 'senders', senderIds: ['a', 'b'] },
      primary: { type: 'archive' },
    });
    // Selection cleared on server confirmation (the bar is gone).
    expect(screen.queryByText(/senders selected/i)).toBeNull();

    // Undo reverses the WHOLE batch via the cascade token.
    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    await waitFor(() => expect(screen.queryByText(/archived 2 senders/i)).toBeNull());
    expect(undoPosted).toBe(true);
  });

  it('keeps the selection when the bulk enqueue fails (no optimistic clear)', async () => {
    let enqueueAttempted = false;
    installFetchStub([
      TWO_SENDER_LIST,
      BULK_PREVIEW_OK,
      {
        method: 'POST',
        path: '/api/actions',
        respond: () => {
          enqueueAttempted = true;
          return jsonServerError('boom');
        },
      },
    ]);

    renderScreen();
    await selectBothAndPress('a');
    await screen.findByText(/will move to Archive/i);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(enqueueAttempted).toBe(true));
    // The selection survives the failure so the user can retry.
    expect(await screen.findByText(/senders selected/i)).toBeInTheDocument();
    // And no receipt was fabricated.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('surfaces a partial batch failure but keeps the succeeded portion undoable', async () => {
    installFetchStub([
      TWO_SENDER_LIST,
      BULK_PREVIEW_OK,
      {
        method: 'POST',
        path: '/api/actions',
        respond: () =>
          jsonOk({
            data: {
              batchId: 'batch-2',
              status: 'queued',
              senderCount: 2,
              requestedTotal: 30,
              skipped: [],
            },
          }),
      },
      {
        method: 'GET',
        path: /^\/api\/actions\/batch\/[^/]+$/,
        respond: () =>
          jsonOk({
            data: {
              batchId: 'batch-2',
              status: 'done',
              total: 2,
              done: 1,
              failed: 1,
              requestedCount: 30,
              affectedCount: 12,
              undoToken: 'tok-partial',
            },
          }),
      },
    ]);

    renderScreen();
    await selectBothAndPress('a');
    await screen.findByText(/will move to Archive/i);
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    // One sender failing never hides the other's real result — the
    // receipt reflects what DID move and stays undoable.
    const receipt = await screen.findByRole('status');
    expect(receipt).toHaveTextContent(/12 of 30 emails changed/i);
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeInTheDocument();
  });

  it('routes bulk Delete through the destructive preview and blocks confirm when the preview fails', async () => {
    installFetchStub([
      TWO_SENDER_LIST,
      {
        method: 'POST',
        path: '/api/actions/preview/bulk',
        respond: () => jsonServerError('preview_down'),
      },
    ]);

    renderScreen();
    await selectBothAndPress('d');
    // Destructive treatment — same Trash copy as single-sender Delete.
    await screen.findByText(/delete mail from 2 senders/i);
    await screen.findByText(/moves to gmail trash/i);
    // D226: a failed preview must BLOCK the destructive confirm.
    await screen.findByText(/preview unavailable/i);
    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /delete/i });
    expect(confirmBtn).toBeDisabled();
  });

  it('offers Delete on the selection bar with the registry shortcut advertised', async () => {
    installFetchStub([TWO_SENDER_LIST, BULK_PREVIEW_OK]);
    renderScreen();
    fireEvent.click(await screen.findByRole('checkbox', { name: /select sender a/i }));
    const deleteBtn = screen.getByTitle('Delete (D)');
    expect(deleteBtn).toHaveAttribute('aria-keyshortcuts', 'D');
    fireEvent.click(deleteBtn);
    // The click routes through the SAME mandatory preview.
    expect(await screen.findByText(/delete mail from 1 sender/i)).toBeInTheDocument();
  });

  const PROTECTED_B = {
    ...ROW_B,
    displayName: 'Protected Co',
    protectionFlags: { ...ROW.protectionFlags, isProtected: true, protectionReason: 'manual' },
  };

  it('states how many senders the eligibility gate skipped, and why (D226 honesty)', async () => {
    // Live smoke 2026-06-09: "2 senders selected" in the bar silently
    // became "1 sender" in the sheet when one was protected. The preview
    // must state the narrowing, never leave the user to spot it.
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [ROW, PROTECTED_B],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              query: { totalMatching: 2, globalMaxTotal: 120, asOf: '2026-05-29T12:00:00.000Z' },
            },
          }),
      },
      {
        method: 'POST',
        path: '/api/actions/preview/bulk',
        respond: () =>
          jsonOk({
            data: {
              senders: [
                {
                  senderId: 'a',
                  name: 'Sender A',
                  counts: {
                    all: 12,
                    olderThan30d: 8,
                    olderThan90d: 5,
                    olderThan180d: 3,
                    olderThan365d: 1,
                  },
                  protected: false,
                },
                {
                  senderId: 'b',
                  name: 'Protected Co',
                  counts: {
                    all: 0,
                    olderThan30d: 0,
                    olderThan90d: 0,
                    olderThan180d: 0,
                    olderThan365d: 0,
                  },
                  protected: true,
                },
              ],
              totals: {
                all: 12,
                olderThan30d: 8,
                olderThan90d: 5,
                olderThan180d: 3,
                olderThan365d: 1,
              },
              protectedCount: 1,
            },
          }),
      },
    ]);

    renderScreen();
    fireEvent.click(await screen.findByRole('checkbox', { name: /select sender a/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select protected co/i }));
    expect(screen.getByText(/senders selected/i)).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'a' });

    // The preview covers the 1 eligible sender AND says what it dropped.
    await screen.findByText(/archive mail from 1 sender/i);
    expect(
      screen.getByText(/1 protected sender skipped — unprotect to include it/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Bulk action scope')).toHaveTextContent(
      '2 selected · 1 eligible · 1 skipped',
    );
  });

  it('toasts instead of opening a preview when the whole selection is protected', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [
              {
                ...ROW,
                displayName: 'Shielded A',
                protectionFlags: {
                  ...ROW.protectionFlags,
                  isProtected: true,
                  protectionReason: 'manual',
                },
              },
              { ...PROTECTED_B, displayName: 'Shielded B' },
            ],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 25 },
              query: { totalMatching: 2, globalMaxTotal: 120, asOf: '2026-05-29T12:00:00.000Z' },
            },
          }),
      },
    ]);

    renderScreenWithToasts();
    fireEvent.click(await screen.findByRole('checkbox', { name: /select shielded a/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select shielded b/i }));
    fireEvent.keyDown(document.body, { key: 'a' });

    // No (empty) preview opens; the toast explains the no-op.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      await screen.findByText(/all 2 selected senders are protected — unprotect to include them/i),
    ).toBeInTheDocument();
  });
});

/**
 * Grid/table toggle (D49) + cursor pagination (D202). These tests
 * exercise "Load more" pagination + the infinite-scroll sentinel.
 */
describe('SendersScreen — view toggle (D49) + pagination & load more (D202)', () => {
  beforeEach(() => {
    useSendersStore.setState({ view: 'grid' });
  });
  afterEach(() => resetFetchStub());

  it('loads the next page when "Load more" is clicked (D202 cursor pagination)', async () => {
    const ROW_B = {
      ...ROW,
      id: 'page2',
      displayName: 'Second Page Sender',
      email: 'b@example.com',
    };
    installFetchStub([
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

  it('auto-fetches the next page when the sentinel intersects (infiniteScroll flag)', async () => {
    // Manual IntersectionObserver harness — happy-dom has no layout, so
    // intersection is driven by hand: capture the observer callback and
    // fire it as if the sentinel scrolled into the 400px margin.
    const callbacks: IntersectionObserverCallback[] = [];
    const observed: Element[] = [];
    class FakeIO {
      cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
        callbacks.push(cb);
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
      unobserve() {}
    }
    const prevIO = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver;

    try {
      const ROW_B = {
        ...ROW,
        id: 'page2',
        displayName: 'Second Page Sender',
        email: 'b@example.com',
      };
      installFetchStub([
        {
          method: 'GET',
          path: '/api/senders',
          respond: (_req, url) =>
            url.searchParams.get('cursor')
              ? jsonOk({
                  data: [ROW_B],
                  meta: {
                    pagination: { nextCursor: null, hasMore: false, limit: 50 },
                    query: {
                      totalMatching: 0,
                      globalMaxTotal: 0,
                      asOf: '2026-05-29T12:00:00.000Z',
                    },
                  },
                })
              : jsonOk({
                  data: [ROW],
                  meta: {
                    pagination: { nextCursor: 'cursor-1', hasMore: true, limit: 50 },
                    query: {
                      totalMatching: 0,
                      globalMaxTotal: 0,
                      asOf: '2026-05-29T12:00:00.000Z',
                    },
                  },
                }),
        },
      ]);

      renderScreen();
      await waitFor(() => expect(screen.getByText('Sender A')).toBeInTheDocument());
      const sentinel = screen.getByTestId('load-more-sentinel');
      expect(observed).toContain(sentinel);

      // Scroll the sentinel "into view" — next page fetches with NO click.
      act(() => {
        callbacks.at(-1)!(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });

      await waitFor(() => expect(screen.getByText('Second Page Sender')).toBeInTheDocument());
      // Last page landed (hasMore=false) — sentinel + button both unmount.
      expect(screen.queryByTestId('load-more-sentinel')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /load more senders/i })).not.toBeInTheDocument();
    } finally {
      globalThis.IntersectionObserver = prevIO;
    }
  });

  it('defaults to grid view and flips to table when the toggle is clicked (D49)', async () => {
    installFetchStub([
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

    renderScreen();
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

/**
 * Real-data counts mandate (#145) — headline figures MUST reflect
 * mailbox-wide aggregates from the server (`?q=` forwarded to both the
 * list and summary endpoints; hero count from `meta.query.totalMatching`),
 * never the ≤50-row loaded page.
 */
describe('SendersScreen — summary-driven aggregates (#145)', () => {
  beforeEach(() => {
    installFetchStub([]);
    useSendersStore.setState({ view: 'grid' });
  });
  afterEach(() => resetFetchStub());

  it('typed search forwards ?q= to both the list AND the summary endpoint', async () => {
    const summaryQ = { value: null as string | null };
    let listQ: string | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) => {
          listQ = url.searchParams.get('q');
          return jsonOk({
            data: [ROW],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 50 },
              query: {
                totalMatching: listQ === 'foo' ? 3 : 1,
                globalMaxTotal: 120,
                asOf: '2026-06-01T00:00:00.000Z',
              },
            },
          });
        },
      },
      sendersSummaryHandler({
        totalSenders: 1,
        activeSenders: 1,
        last30dVolume: 30,
        noiseReducible: 0,
        protected: 0,
        needsReview: 0,
        qCapture: summaryQ,
      }),
    ]);

    renderScreen();
    await screen.findAllByText(/Sender A/);
    // Type into the search box; both endpoints must receive the debounced `q`.
    fireEvent.change(screen.getByRole('combobox', { name: /search senders/i }), {
      target: { value: 'foo' },
    });
    await waitFor(() => expect(summaryQ.value).toBe('foo'), { timeout: 2000 });
    expect(listQ).toBe('foo');
  });
});
