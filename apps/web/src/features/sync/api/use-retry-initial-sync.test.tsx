/**
 * Tests for `useRetryInitialSync` — the mutation behind every "Try
 * again"/"Scan again"/"Reconnect Gmail" control on a failed initial
 * sync (the onboarding gate, Settings → Gmail accounts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { ME_QUERY_KEY } from '@/features/auth/api/use-me';
import { useRetryInitialSync } from './use-retry-initial-sync';

vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: vi.fn() };
});

import { toast } from '@declutrmail/shared';

describe('useRetryInitialSync', () => {
  beforeEach(() => {
    installFetchStub([]);
    vi.mocked(toast).mockClear();
  });
  afterEach(() => resetFetchStub());

  function renderRetry(mailboxId: string | null = 'mb-1') {
    const client = createTestQueryClient();
    const hook = renderHook(() => useRetryInitialSync(mailboxId), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });
    return { ...hook, client };
  }

  it('toasts confirmation on a successful requeue (Codex adversarial review of QA-sync-20260831-03)', async () => {
    // The negative control: reverting the `outcome === 'requeued'` toast
    // makes this assertion fail. `SyncNowButton`'s failed-indicator is the
    // only chrome an already-onboarded user sees for this retry, and it
    // renders `null` again the moment readiness moves to queued/syncing —
    // without this toast, clicking "Scan again" made the button silently
    // vanish with no confirmation anything happened.
    installFetchStub([
      {
        method: 'POST',
        path: '/api/v1/sync/initial/retry',
        respond: () => jsonOk({ data: { outcome: 'requeued' } }),
      },
    ]);
    const { result } = renderRetry();
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // "Queued", not "started" (Codex adversarial review round 2): the
    // response only proves the durable readiness row moved to `queued` —
    // the BullMQ enqueue behind it is best-effort and can fail silently,
    // with the reconciler picking it up later. "Started" would claim an
    // in-flight worker this response never confirmed.
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      'Scan queued — this can take a few minutes.',
      'success',
    );
  });

  it('invalidates `me`, not just the per-mailbox sync-status query, on success (design-system-agent review)', async () => {
    // The negative control: dropping the `ME_QUERY_KEY` invalidation
    // makes this fail. Every surface this branch added (Triage's header
    // + empty state, Senders' freshness + empty state, the account
    // menu, the mailboxes card) reads readiness off `me`, not
    // `SYNC_STATUS_KEY` — without this they'd sit on the pre-retry
    // snapshot until the next poll tick instead of updating the moment
    // the retry lands.
    installFetchStub([
      {
        method: 'POST',
        path: '/api/v1/sync/initial/retry',
        respond: () => jsonOk({ data: { outcome: 'requeued' } }),
      },
    ]);
    const { result, client } = renderRetry();
    client.setQueryData(ME_QUERY_KEY, { fake: 'me-snapshot' });
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(ME_QUERY_KEY)?.isInvalidated).toBe(true);
  });

  it.each(['not_failed', 'no_state'] as const)(
    'does not toast a start confirmation for the designed no-op outcome %s',
    async (outcome) => {
      installFetchStub([
        {
          method: 'POST',
          path: '/api/v1/sync/initial/retry',
          respond: () => jsonOk({ data: { outcome } }),
        },
      ]);
      const { result } = renderRetry();
      act(() => result.current.mutate());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(vi.mocked(toast)).not.toHaveBeenCalled();
    },
  );

  it('toasts a real message on failure, instead of silently doing nothing (QA-sync-20260831-10 item 4)', async () => {
    // The negative control: reverting the `onError` handler makes this
    // assertion fail — a 429 or 5xx on the user's only recovery control
    // used to fail with no visible feedback at all.
    installFetchStub([
      {
        method: 'POST',
        path: '/api/v1/sync/initial/retry',
        respond: () =>
          new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), {
            status: 429,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);
    const { result } = renderRetry();
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      "Couldn't start the scan. Wait a minute and try again — nothing in Gmail changed.",
      'danger',
    );
  });
});
