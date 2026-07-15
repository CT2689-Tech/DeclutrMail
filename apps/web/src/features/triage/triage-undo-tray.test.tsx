/**
 * TriageUndoTray integration tests (D35).
 *
 * The tray reads `GET /api/undo` through the app API client (CSRF +
 * envelope), reverts by token via `POST /api/undo/:token`, polls the
 * reverse job until terminal, and binds `Z` to "undo last" with the
 * same typing guards as the K/A/U/L shortcuts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
}));

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

/** Stub the full revert loop: list → revert POST → reverse-job poll. */
function stubRevertLoop() {
  const posts: string[] = [];
  const reverted = new Set<string>();
  installFetchStub([
    {
      method: 'GET',
      path: '/api/undo',
      respond: () =>
        jsonOk({
          data: [ENTRY_NEWEST, ENTRY_OLDER].filter((e) => !reverted.has(e.token)),
          meta: { nextCursor: null, limit: 50 },
        }),
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
  return { posts };
}

function renderTray(mailboxId?: string) {
  const client = createTestQueryClient();
  const view = render(
    <QueryWrapper client={client}>
      <TriageUndoTray mailboxId={mailboxId} />
    </QueryWrapper>,
  );
  return { ...view, client };
}

describe('TriageUndoTray (D35)', () => {
  beforeEach(() => {
    resetTriageStore();
    h.toast.mockClear();
  });
  afterEach(() => {
    resetFetchStub();
  });

  it('lists active undo entries with per-row Undo affordances', async () => {
    stubRevertLoop();
    renderTray();
    await waitFor(() => expect(screen.getByText('2 decisions applied')).toBeDefined());
    expect(screen.getAllByText('Undo')).toHaveLength(2);
  });

  it('Z reverts the NEWEST entry (undo last) and polls to completion', async () => {
    const { posts } = stubRevertLoop();
    renderTray();
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

    fireEvent.keyDown(window, { key: 'z' });

    await waitFor(() => expect(posts).toEqual([ENTRY_NEWEST.token]));
    // Server-confirmed removal: after the reverse job reports done and
    // the tray refetches, only the older entry remains.
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(1));
  });

  it('per-row Undo click reverts that token', async () => {
    const { posts } = stubRevertLoop();
    renderTray();
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Undo Later' }));
    await waitFor(() => expect(posts).toEqual([ENTRY_OLDER.token]));
  });

  it('Z is suppressed while typing in an input (same guard as K/A/U/L)', async () => {
    const { posts } = stubRevertLoop();
    const client = createTestQueryClient();
    render(
      <QueryWrapper client={client}>
        <input aria-label="search" />
        <TriageUndoTray />
      </QueryWrapper>,
    );
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

    fireEvent.keyDown(screen.getByLabelText('search'), { key: 'z' });
    // Give the (not expected) POST a tick to fire if it were going to.
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toEqual([]);
  });

  it('Z is suppressed while a pending action surface is open (sheet owns the keyboard)', async () => {
    const { posts } = stubRevertLoop();
    renderTray();
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

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
    const { posts } = stubRevertLoop();
    renderTray();
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toEqual([]);
  });

  it('Z respects an earlier handler that already prevented the event', async () => {
    const { posts } = stubRevertLoop();
    renderTray();
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

    const event = new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toEqual([]);
  });

  it('Z is suppressed while an aria-modal dialog is open', async () => {
    const { posts } = stubRevertLoop();
    const client = createTestQueryClient();
    render(
      <QueryWrapper client={client}>
        <div role="dialog" aria-modal="true">
          <button type="button">Dialog action</button>
        </div>
        <TriageUndoTray />
      </QueryWrapper>,
    );
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

    fireEvent.keyDown(screen.getByRole('button', { name: 'Dialog action' }), { key: 'z' });

    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toEqual([]);
  });

  it('Z is suppressed while an open menu is mounted', async () => {
    const { posts } = stubRevertLoop();
    const client = createTestQueryClient();
    render(
      <QueryWrapper client={client}>
        <div role="menu" aria-label="Account menu" />
        <TriageUndoTray />
      </QueryWrapper>,
    );
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

    fireEvent.keyDown(window, { key: 'z' });

    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toEqual([]);
  });

  it('partitions tray data and clears its in-flight hide when the mailbox changes', async () => {
    let undoReads = 0;
    const mailboxHeaders: Array<string | null> = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/undo',
        respond: (req) => {
          undoReads += 1;
          mailboxHeaders.push(req.headers.get('x-active-mailbox-id'));
          return jsonOk({
            data: [ENTRY_NEWEST, ENTRY_OLDER],
            meta: { nextCursor: null, limit: 50 },
          });
        },
      },
      {
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
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Undo Archive' }));
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(1));

    view.rerender(
      <QueryWrapper client={client}>
        <TriageUndoTray mailboxId="mailbox-b" />
      </QueryWrapper>,
    );

    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));
    expect(undoReads).toBe(2);
    expect(mailboxHeaders).toEqual(['mailbox-a', 'mailbox-b']);
    expect(client.getQueryData(undoKeys.tray('mailbox-a'))).toBeDefined();
    expect(client.getQueryData(undoKeys.tray('mailbox-b'))).toBeDefined();
  });

  it('silences an old mailbox revert when the active mailbox changes', async () => {
    let finishPost!: (response: Response) => void;
    const postResponse = new Promise<Response>((resolve) => {
      finishPost = resolve;
    });
    const postMailboxHeaders: Array<string | null> = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/undo',
        respond: () =>
          jsonOk({
            data: [ENTRY_NEWEST, ENTRY_OLDER],
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
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Undo Archive' }));
    await waitFor(() => expect(postMailboxHeaders).toEqual(['mailbox-a']));

    view.rerender(
      <QueryWrapper client={client}>
        <TriageUndoTray mailboxId="mailbox-b" />
      </QueryWrapper>,
    );
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

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
    stubRevertLoop();
    const { container } = renderTray();
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

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
