/**
 * Tests for `resetMailboxScopedCache` — the single source of truth for
 * refreshing mailbox-scoped data when the active mailbox changes (D116).
 * Both switch and disconnect route through it.
 *
 * The bug this guards (2026-05-28): the helper used `qc.clear()`, which
 * empties the cache but does NOT make MOUNTED observers refetch — so a
 * switch only took effect after a hard refresh. The fix is
 * `invalidateQueries()` (refetch active). The live refetch behaviour was
 * verified in the browser; these tests lock the fix + the regression
 * (must invalidate-all, must NOT clear; queries are marked stale).
 */

import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MAILBOX_SCOPE_RESET_EVENT, resetMailboxScopedCache } from './reset-mailbox-cache';

describe('resetMailboxScopedCache', () => {
  it('invalidates all queries (refetch active) and never clear()s — clear left the switch stale', async () => {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const clearSpy = vi.spyOn(qc, 'clear');

    await resetMailboxScopedCache(qc);

    // Invalidate-all (no filter) → refetches mounted observers live.
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith();
    // clear() is the bug — it empties the cache without refetching the
    // mounted me/senders observers, so the UI stayed stale until reload.
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('marks existing mailbox-scoped queries stale so they refetch', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['senders', 'list'], [{ id: 'a' }]);
    qc.setQueryData(['triage', 'queue'], [{ id: 'q' }]);

    await resetMailboxScopedCache(qc);

    expect(qc.getQueryState(['senders', 'list'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['triage', 'queue'])?.isInvalidated).toBe(true);
  });

  it('notifies the app shell to refresh mailbox-scoped server payloads', async () => {
    const qc = new QueryClient();
    const listener = vi.fn();
    window.addEventListener(MAILBOX_SCOPE_RESET_EVENT, listener);

    await resetMailboxScopedCache(qc);

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(MAILBOX_SCOPE_RESET_EVENT, listener);
  });

  /**
   * Codex review 2026-09-03: `invalidateQueries()` AWAITS every active
   * query's refetch. If the event fired only after that await resolved,
   * every one of those refetches would already have stamped its
   * `dataUpdatedAt`/`errorUpdatedAt` to a moment strictly BEFORE a
   * listener's generation-boundary timestamp — making the freshest
   * possible read of the new mailbox look stale by definition. Firing
   * the event first (this test) is what makes sender-detail-page's
   * `mailboxResetAtRef` comparison actually inclusive of fresh data.
   */
  it('fires the reset event before invalidating, not after', async () => {
    const qc = new QueryClient();
    const order: string[] = [];
    const listener = () => order.push('event');
    window.addEventListener(MAILBOX_SCOPE_RESET_EVENT, listener);
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries').mockImplementation(async () => {
      order.push('invalidate');
    });

    await resetMailboxScopedCache(qc);

    expect(order).toEqual(['event', 'invalidate']);
    window.removeEventListener(MAILBOX_SCOPE_RESET_EVENT, listener);
    invalidateSpy.mockRestore();
  });

  /**
   * Codex review 2026-09-03, round 4: a query still on its FIRST fetch
   * (no cached data yet — e.g. a sender-detail page opened moments
   * before this switch) is not restarted by `invalidateQueries()` alone:
   * TanStack dedupes an already-in-flight fetch instead of cancelling
   * and re-issuing it. That original request resolves server-side
   * against whichever mailbox was active when ITS guard ran — possibly
   * the one being switched away from — and its late-arriving response
   * would land stamped with a `dataUpdatedAt` past the reset boundary,
   * indistinguishable from a genuine post-switch read by a timestamp
   * check alone. `cancelQueries()` must actually abort it, and the
   * cancelled fetch's result must never reach the cache.
   */
  it('cancels an in-flight, still-dataless query instead of letting its stale response land after reset', async () => {
    const qc = new QueryClient();
    let releaseStaleResponse!: () => void;
    const staleResponsePending = new Promise<void>((resolve) => {
      releaseStaleResponse = resolve;
    });
    let firstCallAborted = false;
    let callCount = 0;

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['probe-sender-detail'],
          queryFn: async ({ signal }) => {
            callCount += 1;
            if (callCount === 1) {
              signal.addEventListener('abort', () => {
                firstCallAborted = true;
              });
              await staleResponsePending;
              return { mailbox: 'A', call: 1 };
            }
            return { mailbox: 'B', call: 2 };
          },
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(QueryClientProvider, { client: qc }, children),
      },
    );
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(callCount).toBe(1);

    // Simulate the switch while the first, still-dataless fetch is in
    // flight, THEN let its (wrong-mailbox) response arrive — the exact
    // ordering round 4 found. Must not await before releasing: the
    // reset's own `invalidateQueries()` should already be re-fetching
    // (call 2) by the time this resolves.
    const resetPromise = resetMailboxScopedCache(qc);
    releaseStaleResponse();
    await resetPromise;

    expect(firstCallAborted).toBe(true);
    await waitFor(() =>
      expect(qc.getQueryData(['probe-sender-detail'])).toEqual({ mailbox: 'B', call: 2 }),
    );
  });
});
