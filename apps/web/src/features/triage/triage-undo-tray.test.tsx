/**
 * TriageUndoTray integration tests (D35).
 *
 * The tray reads `GET /api/undo` through the app API client (CSRF +
 * envelope), reverts by token via `POST /api/undo/:token`, polls the
 * reverse job until terminal, and binds `Z` to "undo last" with the
 * same typing guards as the K/A/U/L shortcuts.
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { UndoTrayEntry } from '@declutrmail/shared';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { undoKeys } from '@/features/undo/query-keys';
import { floatingSurfaceLayout } from '@/lib/ui/floating-surface-layout';
import { resetTriageStore, useTriageStore } from './store';
import { TriageUndoTray } from './triage-undo-tray';

const h = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: h.toast };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => mockPathname,
}));

/** Drives the tray's per-screen baseline; reassign to simulate a route change. */
let mockPathname = '/triage';

const ENTRY_NEWEST = {
  token: '11111111-1111-4111-8111-111111111111',
  actionKind: 'archive' as const,
  createdAt: '2026-06-09T10:01:00.000Z',
  expiresAt: '2026-06-16T10:01:00.000Z',
};
const ENTRY_OLDER = {
  token: '22222222-2222-4222-8222-222222222222',
  actionKind: 'later' as const,
  createdAt: '2026-06-09T10:00:00.000Z',
  expiresAt: '2026-06-16T10:00:00.000Z',
};
/** A decision taken AFTER a screen change — the tray must show this one. */
const ENTRY_THIRD = {
  token: '44444444-4444-4444-8444-444444444444',
  actionKind: 'delete' as const,
  createdAt: '2026-06-09T10:05:00.000Z',
  expiresAt: '2026-06-14T10:05:00.000Z',
};

/** Stub the full revert loop: list → revert POST → reverse-job poll. */
function stubRevertLoop() {
  const posts: string[] = [];
  const reverted = new Set<string>();
  // Starts EMPTY. The tray baselines against whatever is already live
  // when a screen mounts, so entries seeded before mount are history and
  // never render — tests have to land them the way an action does (see
  // `renderTrayWithDecisions`).
  const state = { reads: 0, live: [] as UndoTrayEntry[] };
  installFetchStub([
    {
      method: 'GET',
      path: '/api/undo',
      respond: () => {
        state.reads += 1;
        return jsonOk({
          data: state.live.filter((e) => !reverted.has(e.token)),
          meta: { nextCursor: null, limit: 50 },
        });
      },
    },
    {
      method: 'POST',
      path: /\/api\/undo\/.+/,
      respond: (_req, url) => {
        const token = url.pathname.split('/').pop()!;
        posts.push(token);
        reverted.add(token);
        return jsonOk({
          data: {
            token,
            actionKind: 'archive',
            reverted: false,
            expired: false,
            revertedAt: null,
            actionId: '33333333-3333-4333-8333-333333333333',
          },
        });
      },
    },
    {
      method: 'GET',
      path: /\/api\/actions\/.+/,
      respond: () =>
        jsonOk({
          data: {
            actionId: '33333333-3333-4333-8333-333333333333',
            status: 'done',
            requestedCount: 2,
            affectedCount: 2,
            undoToken: null,
            errorCode: null,
          },
        }),
    },
  ]);
  return { posts, state };
}

function renderTray({ mailboxId, before }: { mailboxId?: string; before?: ReactNode } = {}) {
  const client = createTestQueryClient();
  const view = render(
    <QueryWrapper client={client}>
      {before}
      <TriageUndoTray mailboxId={mailboxId} />
    </QueryWrapper>,
  );
  return { ...view, client };
}

/**
 * Mount the tray, let it baseline against an empty `/api/undo`, then
 * land two decisions the way a real action does — `useActionStatus`
 * invalidates `undoKeys.all` when a job goes terminal, the tray
 * refetches, and the new tokens are (by definition) not in the
 * baseline. This is the ONLY path that puts rows in the tray.
 */
async function renderTrayWithDecisions(
  options: { mailboxId?: string; before?: ReactNode } = {},
): Promise<ReturnType<typeof renderTray> & ReturnType<typeof stubRevertLoop>> {
  const stub = stubRevertLoop();
  const view = renderTray(options);
  // Wait for the empty list to LAND, not merely to be requested: the
  // baseline is captured from settled data, and invalidating mid-flight
  // is deduped into the request already running.
  await waitFor(() =>
    expect(view.client.getQueryData(undoKeys.tray(options.mailboxId))).toBeDefined(),
  );
  stub.state.live = [ENTRY_NEWEST, ENTRY_OLDER];
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: undoKeys.all });
  });
  await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));
  return { ...view, ...stub };
}

describe('TriageUndoTray (D35)', () => {
  beforeEach(() => {
    resetTriageStore();
    h.toast.mockClear();
    mockPathname = '/triage';
  });
  afterEach(() => {
    resetFetchStub();
  });

  it('lists active undo entries with per-row Undo affordances', async () => {
    await renderTrayWithDecisions();
    expect(screen.getByText('2 decisions applied')).toBeDefined();
    expect(screen.getAllByText('Undo')).toHaveLength(2);
  });

  // The tray is decision feedback for the screen you are ON (D35 "tray
  // persists during the session"), not a list of every live token. Undo
  // windows run for days — Delete's is 5 (ADR-0019) — so rendering the
  // raw list pinned "Moved to Gmail Trash" over Autopilot, Quiet and
  // Billing long after the act, and again on the next session's first
  // load. Long-tail undo belongs to Activity, which each row links to.
  it('hides decisions carried in from another screen, and shows new ones taken here', async () => {
    const view = await renderTrayWithDecisions();

    mockPathname = '/autopilot';
    view.rerender(
      <QueryWrapper client={view.client}>
        <TriageUndoTray />
      </QueryWrapper>,
    );
    await waitFor(() => expect(screen.queryByText('Undo')).toBeNull());
    expect(document.querySelector('[data-dm-undo-tray]')).toBeNull();

    // Acting on THIS screen fills it again — the baseline hides history,
    // never the feedback for what you just did.
    view.state.live = [...view.state.live, ENTRY_THIRD];
    await act(async () => {
      await view.client.invalidateQueries({ queryKey: undoKeys.all });
    });
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(1));
    expect(screen.getByText('1 decision applied')).toBeDefined();
  });

  // `isLoading` is true only while a scope's FIRST fetch is in flight —
  // exactly the fetch whose contents the baseline swallows. Forwarding it
  // would flash an empty "Loading…" tray on every boot and mailbox switch.
  it('never flashes a loading tray while the first fetch is in flight', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/undo',
        respond: () => new Promise<Response>(() => undefined),
      },
    ]);
    const { container } = renderTray();
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-dm-undo-tray]')).toBeNull();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  // The tray is `position: fixed` at the viewport bottom and mounted
  // outside AppShell's content scroller, so it overlaps the content's
  // last ~90px. It publishes its height for the scroller to reserve as
  // bottom padding; without that, /billing's checkout Confirm button
  // was covered AND unreachable, since the scroller was already at its
  // end (browser smoke 2026-07-29). Unmount must clear the reserve or
  // every screen keeps dead space under it forever.
  it('publishes its height for scrollers to reserve, and clears it on unmount', async () => {
    const { unmount } = await renderTrayWithDecisions();

    const published = document.documentElement.style.getPropertyValue('--dm-undo-tray-inset');
    expect(published).toMatch(/^\d+px$/);
    expect(Number.parseInt(published, 10)).toBeGreaterThan(0);

    unmount();
    expect(document.documentElement.style.getPropertyValue('--dm-undo-tray-inset')).toBe('');
  });

  it('Z reverts the NEWEST entry (undo last) and polls to completion', async () => {
    const { posts } = await renderTrayWithDecisions();

    fireEvent.keyDown(window, { key: 'z' });

    await waitFor(() => expect(posts).toEqual([ENTRY_NEWEST.token]));
    // Server-confirmed removal: after the reverse job reports done and
    // the tray refetches, only the older entry remains.
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(1));
  });

  it('per-row Undo click reverts that token', async () => {
    const { posts } = await renderTrayWithDecisions();

    fireEvent.click(screen.getByRole('button', { name: 'Undo Later' }));
    await waitFor(() => expect(posts).toEqual([ENTRY_OLDER.token]));
  });

  it('Z is suppressed while typing in an input (same guard as K/A/U/L)', async () => {
    const { posts } = await renderTrayWithDecisions({
      before: <input aria-label="search" />,
    });

    fireEvent.keyDown(screen.getByLabelText('search'), { key: 'z' });
    // Give the (not expected) POST a tick to fire if it were going to.
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toEqual([]);
  });

  it('Z is suppressed while a pending action surface is open (sheet owns the keyboard)', async () => {
    const { posts } = await renderTrayWithDecisions();

    useTriageStore.setState({
      pendingAction: { verb: 'Archive', rowId: 'row-1', surface: 'sheet', wakeAt: null },
    });
    // Re-render tick so the tray sees the store change.
    await waitFor(() => expect(useTriageStore.getState().pendingAction).not.toBeNull());

    fireEvent.keyDown(window, { key: 'z' });
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toEqual([]);
  });

  it('Z with a modifier key is ignored (browser chords stay intact)', async () => {
    const { posts } = await renderTrayWithDecisions();

    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toEqual([]);
  });

  it('Z respects an earlier handler that already prevented the event', async () => {
    const { posts } = await renderTrayWithDecisions();

    const event = new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toEqual([]);
  });

  it('Z is suppressed while an aria-modal dialog is open', async () => {
    const { posts } = await renderTrayWithDecisions({
      before: (
        <div role="dialog" aria-modal="true">
          <button type="button">Dialog action</button>
        </div>
      ),
    });

    fireEvent.keyDown(screen.getByRole('button', { name: 'Dialog action' }), { key: 'z' });

    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toEqual([]);
  });

  it('Z is suppressed while an open menu is mounted', async () => {
    const { posts } = await renderTrayWithDecisions({
      before: <div role="menu" aria-label="Account menu" />,
    });

    fireEvent.keyDown(window, { key: 'z' });

    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toEqual([]);
  });

  it('partitions tray data and clears its in-flight hide when the mailbox changes', async () => {
    const mailboxHeaders: Array<string | null> = [];
    const live: Record<string, UndoTrayEntry[]> = {
      'mailbox-a': [],
      'mailbox-b': [],
    };
    installFetchStub([
      {
        method: 'GET',
        path: '/api/undo',
        respond: (req) => {
          const mailbox = req.headers.get('x-active-mailbox-id');
          mailboxHeaders.push(mailbox);
          return jsonOk({
            data: live[mailbox ?? ''] ?? [],
            meta: { nextCursor: null, limit: 50 },
          });
        },
      },
      {
        // Never resolves — the revert stays in flight across the switch.
        method: 'POST',
        path: /\/api\/undo\/.+/,
        respond: () => new Promise<Response>(() => undefined),
      },
    ]);
    const client = createTestQueryClient();
    const view = render(
      <QueryWrapper client={client}>
        <TriageUndoTray mailboxId="mailbox-a" />
      </QueryWrapper>,
    );
    await waitFor(() => expect(client.getQueryData(undoKeys.tray('mailbox-a'))).toBeDefined());
    live['mailbox-a'] = [ENTRY_NEWEST, ENTRY_OLDER];
    await act(async () => {
      await client.invalidateQueries({ queryKey: undoKeys.all });
    });
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Undo Archive' }));
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(1));

    view.rerender(
      <QueryWrapper client={client}>
        <TriageUndoTray mailboxId="mailbox-b" />
      </QueryWrapper>,
    );
    // mailbox-a's decisions are not mailbox-b's — the baseline is keyed
    // on the mailbox, so a switch never exposes the other inbox's tray.
    await waitFor(() => expect(client.getQueryData(undoKeys.tray('mailbox-b'))).toBeDefined());
    expect(screen.queryByText('Undo')).toBeNull();

    // A decision landing on mailbox-b renders — and it reuses the token
    // whose revert is still in flight from mailbox-a, so a stale
    // `inFlight` slot would swallow this row.
    live['mailbox-b'] = [ENTRY_NEWEST];
    await act(async () => {
      await client.invalidateQueries({ queryKey: undoKeys.all });
    });
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(1));

    expect(mailboxHeaders.slice(0, 3)).toEqual(['mailbox-a', 'mailbox-a', 'mailbox-b']);
    expect(client.getQueryData(undoKeys.tray('mailbox-a'))).toBeDefined();
    expect(client.getQueryData(undoKeys.tray('mailbox-b'))).toBeDefined();
  });

  it('silences an old mailbox revert when the active mailbox changes', async () => {
    let finishPost!: (response: Response) => void;
    const postResponse = new Promise<Response>((resolve) => {
      finishPost = resolve;
    });
    const postMailboxHeaders: Array<string | null> = [];
    let live: UndoTrayEntry[] = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/undo',
        respond: () =>
          jsonOk({
            data: live,
            meta: { nextCursor: null, limit: 50 },
          }),
      },
      {
        method: 'POST',
        path: /\/api\/undo\/.+/,
        respond: (req) => {
          postMailboxHeaders.push(req.headers.get('x-active-mailbox-id'));
          return postResponse;
        },
      },
    ]);
    const client = createTestQueryClient();
    const view = render(
      <QueryWrapper client={client}>
        <TriageUndoTray mailboxId="mailbox-a" />
      </QueryWrapper>,
    );
    await waitFor(() => expect(client.getQueryData(undoKeys.tray('mailbox-a'))).toBeDefined());
    live = [ENTRY_NEWEST, ENTRY_OLDER];
    await act(async () => {
      await client.invalidateQueries({ queryKey: undoKeys.all });
    });
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Undo Archive' }));
    await waitFor(() => expect(postMailboxHeaders).toEqual(['mailbox-a']));

    view.rerender(
      <QueryWrapper client={client}>
        <TriageUndoTray mailboxId="mailbox-b" />
      </QueryWrapper>,
    );
    await waitFor(() => expect(client.getQueryData(undoKeys.tray('mailbox-b'))).toBeDefined());

    await act(async () => {
      finishPost(
        jsonOk({
          data: {
            token: ENTRY_NEWEST.token,
            actionKind: 'archive',
            reverted: true,
            expired: false,
            revertedAt: '2026-06-09T10:02:00.000Z',
            actionId: null,
          },
        }),
      );
      await postResponse;
    });

    expect(h.toast).not.toHaveBeenCalled();
  });

  it('stays above the Senders selection-bar footprint', async () => {
    const { container } = await renderTrayWithDecisions();

    const tray = container.querySelector<HTMLElement>('[data-dm-undo-tray]');
    expect(tray?.style.bottom).toBe(`${floatingSurfaceLayout.undoTrayBottom}px`);
    expect(floatingSurfaceLayout.undoTrayBottom).toBeGreaterThan(
      floatingSurfaceLayout.selectionBarBottom + floatingSurfaceLayout.selectionBarHeight,
    );
    expect(floatingSurfaceLayout.selectionBarZIndex).toBeGreaterThan(
      floatingSurfaceLayout.undoTrayZIndex,
    );
  });

  it('renders nothing when there are no active tokens (D35 invisible tray)', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/undo',
        respond: () => jsonOk({ data: [], meta: { nextCursor: null, limit: 50 } }),
      },
    ]);
    const { container } = renderTray();
    await waitFor(() => expect(container.querySelector('[data-dm-undo-tray]')).toBeNull());
  });
});
