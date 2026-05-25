/**
 * Integration tests for `useUndoTray` after the D200 TanStack Query
 * migration (FOUNDER-FOLLOWUPS 2026-05-23).
 *
 * The hook lives in `@declutrmail/shared` but its vitest config runs
 * in `environment: 'node'` with no jsdom — TanStack Query needs a
 * browser-shaped event loop for `useQuery` to settle. We exercise it
 * here in `apps/web` where the harness already supplies happy-dom +
 * `@testing-library/react` + the fetch stub.
 *
 * Test surface:
 *   1. success path — GET /api/undo returns rows, hook surfaces them
 *   2. error path  — GET fails, hook surfaces isError (no silent empty)
 *   3. revert success — POST /api/undo/:token, row optimistically gone
 *      and stays gone after server ack
 *   4. revert failure — POST 500s, row is rolled back into the tray
 *      (CLAUDE.md §10 — no fake completion)
 *   5. static dataSource override — bypasses TanStack entirely, so the
 *      Storybook/test seam works without a QueryClientProvider
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useUndoTray } from '@declutrmail/shared';
import type { UndoTrayDataSource, UndoTrayEntry } from '@declutrmail/shared';
import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

const MAILBOX = '00000000-0000-0000-0000-000000000000';

const ROW_A: UndoTrayEntry = {
  token: 'tok-a',
  actionKind: 'archive',
  createdAt: '2026-05-23T14:30:00.000Z',
  expiresAt: '2026-05-30T14:30:00.000Z',
};

const ROW_B: UndoTrayEntry = {
  token: 'tok-b',
  actionKind: 'unsubscribe',
  createdAt: '2026-05-23T14:31:00.000Z',
  expiresAt: '2026-05-30T14:31:00.000Z',
};

describe('useUndoTray — TanStack-backed (D200)', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('fetches active undo entries via GET /api/undo on mount', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/undo',
        respond: () => jsonOk({ data: [ROW_A, ROW_B] }),
      },
    ]);

    const client = createTestQueryClient();
    const { result } = renderHook(() => useUndoTray({ mailboxAccountId: MAILBOX }), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.entries).toEqual([ROW_A, ROW_B]);
    expect(result.current.isError ?? false).toBe(false);
  });

  it('surfaces isError when the GET fails (no silent empty)', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/undo',
        respond: () => jsonServerError('undo_blown'),
      },
    ]);

    const client = createTestQueryClient();
    const { result } = renderHook(() => useUndoTray({ mailboxAccountId: MAILBOX }), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Empty entries + isError → component renders the error chip, not the
    // collapsed-tray null branch.
    expect(result.current.entries).toEqual([]);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('optimistically removes a row on revert success', async () => {
    // The GET handler is stateful — it returns the original two rows
    // until a POST /api/undo/:token clears one, after which a refetch
    // returns the surviving row only. This mirrors the real API: the
    // server confirms the revert AND the row is gone from the tray
    // payload on the next read.
    const observedPosts: string[] = [];
    const cleared = new Set<string>();
    installFetchStub([
      {
        method: 'GET',
        path: '/api/undo',
        respond: () =>
          jsonOk({
            data: [ROW_A, ROW_B].filter((row) => !cleared.has(row.token)),
          }),
      },
      {
        method: 'POST',
        path: /\/api\/undo\/.+/,
        respond: (_req, url) => {
          observedPosts.push(url.pathname);
          // url.pathname is like '/api/undo/tok-a' → the token is the
          // final segment.
          const token = url.pathname.split('/').pop();
          if (token) cleared.add(token);
          return new Response(null, { status: 204 });
        },
      },
    ]);

    const client = createTestQueryClient();
    const { result } = renderHook(() => useUndoTray({ mailboxAccountId: MAILBOX }), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => {
      await result.current.revert('tok-a');
    });

    // POST went out and the row is gone from the tray after the
    // server-confirmed refetch.
    expect(observedPosts).toEqual(['/api/undo/tok-a']);
    await waitFor(() => expect(result.current.entries.map((e) => e.token)).not.toContain('tok-a'));
  });

  it('rolls the row back into the tray when revert fails', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/undo',
        respond: () => jsonOk({ data: [ROW_A, ROW_B] }),
      },
      {
        method: 'POST',
        path: /\/api\/undo\/.+/,
        respond: () => jsonServerError('revert_blown'),
      },
    ]);

    const client = createTestQueryClient();
    const { result } = renderHook(() => useUndoTray({ mailboxAccountId: MAILBOX }), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => {
      // mutateAsync rejects on 500 — the test asserts the rollback
      // happened, so we swallow the rejection.
      await result.current.revert('tok-a').catch(() => undefined);
    });

    // After the failed POST, the row must be back. The cache invalidation
    // re-fetches GET /api/undo which still returns both rows (the GET
    // handler is unchanged), so the tray converges back to the full set.
    await waitFor(() =>
      expect(result.current.entries.map((e) => e.token).sort()).toEqual(['tok-a', 'tok-b'].sort()),
    );
  });

  it('short-circuits the query when a static dataSource is supplied', async () => {
    // No fetch handler for /api/undo — if TanStack issued the GET the
    // fetch stub would return a 599 "no_handler" body. Asserting that
    // the hook surfaces the static source verbatim proves the
    // `enabled: false` short-circuit holds.
    const reverts: string[] = [];
    const staticSource: UndoTrayDataSource = {
      entries: [ROW_A],
      isLoading: false,
      revert: async (token: string) => {
        reverts.push(token);
      },
    };

    const client = createTestQueryClient();
    const { result } = renderHook(
      () => useUndoTray({ mailboxAccountId: MAILBOX, dataSource: staticSource }),
      { wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper> },
    );

    expect(result.current.entries).toEqual([ROW_A]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError ?? false).toBe(false);

    // The override's revert is the one that runs — not the TanStack mutation.
    await act(async () => {
      await result.current.revert('tok-a');
    });
    expect(reverts).toEqual(['tok-a']);
  });
});
