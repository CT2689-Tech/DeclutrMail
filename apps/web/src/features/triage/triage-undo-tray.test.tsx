/**
 * TriageUndoTray integration tests (D35).
 *
 * The tray reads `GET /api/undo` through the app API client (CSRF +
 * envelope), reverts by token via `POST /api/undo/:token`, polls the
 * reverse job until terminal, and binds `Z` to "undo last" with the
 * same typing guards as the K/A/U/L shortcuts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { resetTriageStore, useTriageStore } from './store';
import { TriageUndoTray } from './triage-undo-tray';

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

function renderTray() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <TriageUndoTray />
    </QueryWrapper>,
  );
}

describe('TriageUndoTray (D35)', () => {
  beforeEach(() => {
    resetTriageStore();
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
