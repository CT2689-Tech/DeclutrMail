'use client';

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';

import type { UndoTrayDataSource, UndoTrayEntry } from './undo-tray.types';

/**
 * Persistent-undo-tray data hook (D35, D58, D200).
 *
 * Reads active undo tokens from `GET /api/undo` and exposes a stable
 * `revert(token)` callback that POSTs `/api/undo/:token`. Built on
 * TanStack Query so the tray gets first-class:
 *
 *   - `isLoading` from `useQuery({ ... }).isLoading`
 *   - error state that renders distinctly from "no tokens" (Empty
 *     is a `200 OK` with `data: []`; Error is a thrown response).
 *   - refetch on window focus — an action taken in another tab
 *     surfaces in this tab's tray.
 *   - optimistic mutation rollback — `revert()` removes the row
 *     immediately, then puts it back on a failed POST so the user
 *     can retry instead of silently losing the token.
 *
 * Why the hook still returns the `UndoTrayDataSource` contract:
 * consumers (the `<UndoTray>` component, the future Triage
 * integration) read a small, library-agnostic surface — the
 * migration must be invisible to them. The `dataSource` override
 * remains so Storybook and tests can supply canned data without
 * needing a QueryClient mounted in the test environment.
 *
 * Static-source mode is implemented by passing `enabled: false` to
 * `useQuery` — TanStack still runs but never fires its `queryFn`,
 * so the rules-of-hooks rule sees an unconditional hook call. The
 * function ALSO requires a `QueryClientProvider` somewhere above it
 * (TanStack's `useQueryClient` throws otherwise) — even when a static
 * `dataSource` is supplied. In practice both consumers (`<UndoTray>`
 * mounted inside `apps/web` routes; tests using `QueryWrapper`) sit
 * under a provider, so the constraint is invisible.
 */
export function useUndoTray(options: {
  /** Mailbox account UUID — passed as `x-mailbox-account-id` header. */
  mailboxAccountId: string;
  /**
   * Override for tests + Storybook. When provided, the hook still
   * mounts the TanStack hooks (rules-of-hooks compliance) but
   * `useQuery` is disabled (`enabled: false`) so no network call
   * fires, and the override is returned verbatim. Requires a
   * `QueryClientProvider` above the tree just like the live path.
   */
  dataSource?: UndoTrayDataSource;
  /** API base URL (default `/api`); allows local dev overrides. */
  apiBaseUrl?: string;
}): UndoTrayDataSource {
  const { mailboxAccountId, dataSource, apiBaseUrl = '/api' } = options;

  const queryClient = useQueryClient();
  const queryKey = useMemo<QueryKey>(() => ['undo', mailboxAccountId], [mailboxAccountId]);

  const query = useQuery<UndoTrayEntry[], Error>({
    queryKey,
    queryFn: ({ signal }) => fetchUndoEntries({ apiBaseUrl, mailboxAccountId, signal }),
    // When a static source is supplied the query never runs — the
    // hook returns the static value below. The hook call itself
    // still happens so React's render order is stable.
    enabled: dataSource === undefined,
    // The tray must react to actions taken in another tab — D35 calls
    // out cross-tab consistency. The default `makeQueryClient` opts
    // out of refetch-on-focus globally; this hook opts back in.
    refetchOnWindowFocus: true,
  });

  const mutation = useMutation<unknown, Error, string, { previous: UndoTrayEntry[] }>({
    mutationFn: (token) => postUndoRevert({ apiBaseUrl, mailboxAccountId, token }),

    // Optimistically remove the row so the tray feels instant.
    onMutate: async (token) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<UndoTrayEntry[]>(queryKey) ?? [];
      queryClient.setQueryData<UndoTrayEntry[]>(
        queryKey,
        previous.filter((entry) => entry.token !== token),
      );
      return { previous };
    },

    // Rollback on failure so the user can retry instead of silently
    // losing the token. CLAUDE.md §10 — no fake completion.
    onError: (_err, _token, ctx) => {
      if (ctx) {
        queryClient.setQueryData<UndoTrayEntry[]>(queryKey, ctx.previous);
      }
    },

    // Reconcile with the server either way so a partial response
    // (token expired between optimistic remove and server ack)
    // doesn't leave stale rows.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const revert = useCallback(
    async (token: string): Promise<void> => {
      if (dataSource) {
        // Defer to the supplied source so test / Storybook callbacks
        // run instead of issuing a real POST.
        await dataSource.revert(token);
        return;
      }
      await mutation.mutateAsync(token);
    },
    [dataSource, mutation],
  );

  if (dataSource) {
    return dataSource;
  }

  return {
    entries: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ?? null,
    revert,
  };
}

// ── network helpers ────────────────────────────────────────────────

async function fetchUndoEntries({
  apiBaseUrl,
  mailboxAccountId,
  signal,
}: {
  apiBaseUrl: string;
  mailboxAccountId: string;
  signal?: AbortSignal;
}): Promise<UndoTrayEntry[]> {
  const res = await fetch(`${apiBaseUrl}/undo`, {
    method: 'GET',
    headers: { 'x-mailbox-account-id': mailboxAccountId },
    credentials: 'include',
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    throw new Error(`undo_fetch_failed:${res.status}`);
  }
  const body = (await res.json()) as { data?: UndoTrayEntry[] } | UndoTrayEntry[];
  // Defensive: the contract is `{ data: [...] }` per the API
  // envelope (D202), but a misconfigured proxy could return a bare
  // array — treat both shapes as success.
  if (Array.isArray(body)) {
    return body;
  }
  return body.data ?? [];
}

async function postUndoRevert({
  apiBaseUrl,
  mailboxAccountId,
  token,
}: {
  apiBaseUrl: string;
  mailboxAccountId: string;
  token: string;
}): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/undo/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'x-mailbox-account-id': mailboxAccountId },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`undo_revert_failed:${res.status}`);
  }
  // Drain the body so the connection can return to the pool.
  await res.text();
}
