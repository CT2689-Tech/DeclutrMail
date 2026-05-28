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

import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { resetMailboxScopedCache } from './reset-mailbox-cache';

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
});
