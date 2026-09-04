/**
 * Tests for `makeQueryClient` (D200) — specifically the U13 global
 * MutationCache handler: an entitlement 402 from ANY mutation must
 * land in the upgrade-gate store (the UpgradeModal's data source)
 * without per-hook wiring; every other failure must leave it alone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureFeatureException = vi.fn();
vi.mock('./sentry', () => ({
  captureFeatureException: (...a: unknown[]) => captureFeatureException(...a),
}));

import { ApiError } from '@/lib/api/client';
import { useUpgradeGateStore } from '@/lib/entitlements/upgrade-gate';
import { SyncNowError } from '@/features/sync/api/use-sync-now';

import { makeQueryClient } from './query-client';

async function runFailingMutation(error: unknown): Promise<void> {
  const client = makeQueryClient();
  const observerMutation = client.getMutationCache().build(client, {
    mutationFn: () => Promise.reject(error),
  });
  await observerMutation.execute(undefined).catch(() => undefined);
}

beforeEach(() => {
  useUpgradeGateStore.getState().dismiss();
  captureFeatureException.mockClear();
});

/** Drive one failing READ through the client's QueryCache. */
async function runFailingQuery(error: unknown, queryKey: readonly unknown[]): Promise<void> {
  const client = makeQueryClient();
  await client
    .fetchQuery({ queryKey, queryFn: () => Promise.reject(error), retry: false })
    .catch(() => undefined);
}

describe('makeQueryClient — global entitlement-402 handler', () => {
  it('routes a FREE_CAP_REACHED 402 into the upgrade-gate store', async () => {
    await runFailingMutation(
      new ApiError(
        402,
        {
          error: {
            code: 'FREE_CAP_REACHED',
            details: { remaining: 0, limit: 5, used: 5, requiredUnits: 1 },
          },
        },
        'POST /api/actions failed: 402',
      ),
    );
    expect(useUpgradeGateStore.getState().hit?.reason).toBe('free_cap');
  });

  it('routes an INBOX_LIMIT_REACHED 402 into the upgrade-gate store', async () => {
    await runFailingMutation(
      new ApiError(
        402,
        { error: { code: 'INBOX_LIMIT_REACHED', details: { limit: 1, connected: 1 } } },
        'POST /api/auth/google/connect failed: 402',
      ),
    );
    expect(useUpgradeGateStore.getState().hit?.reason).toBe('inbox_limit');
  });

  it('routes an ACTION_TIER_REQUIRED 402 into the upgrade-gate store', async () => {
    await runFailingMutation(
      new ApiError(
        402,
        {
          error: {
            code: 'ACTION_TIER_REQUIRED',
            details: {
              tier: 'free',
              requiredTier: 'plus',
              selector: 'multi-sender',
              verb: 'archive',
            },
          },
        },
        'POST /api/actions failed: 402',
      ),
    );
    expect(useUpgradeGateStore.getState().hit?.reason).toBe('action_tier');
  });

  it('leaves the store untouched for non-entitlement failures', async () => {
    await runFailingMutation(new ApiError(500, { error: { code: 'INTERNAL_ERROR' } }, 'boom'));
    await runFailingMutation(new Error('network down'));
    expect(useUpgradeGateStore.getState().hit).toBeNull();
  });
});

describe('makeQueryClient — global mailbox-scope-conflict recovery', () => {
  /** Same shape as `runFailingMutation`, but hands back the client to spy on. */
  async function failOn(error: unknown): Promise<{ resetCalls: number }> {
    const client = makeQueryClient();
    let resetCalls = 0;
    const realInvalidate = client.invalidateQueries.bind(client);
    client.invalidateQueries = ((filters?: unknown, ...rest: unknown[]) => {
      // `resetMailboxScopedCache` is a bare, filterless invalidate.
      if (filters === undefined) resetCalls += 1;
      return (realInvalidate as (...a: unknown[]) => Promise<void>)(filters, ...rest);
    }) as typeof client.invalidateQueries;

    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(error),
    });
    await mutation.execute(undefined).catch(() => undefined);
    // `onError` fires `resetMailboxScopedCache` fire-and-forget (`void`,
    // never awaited by the caller — see query-client.ts). It now awaits
    // `cancelQueries()` before `invalidateQueries()` (Codex review round
    // 4), one more microtask hop than this mock's synchronous-call
    // interception alone can observe. Flush pending microtasks/a macrotask
    // turn so that extra hop has landed either way before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { resetCalls };
  }

  function conflict(code: string) {
    return new ApiError(409, { error: { code, message: code } }, code);
  }

  // A mutation that fails the mailbox guard proves the client's active
  // mailbox is wrong. Reads already treat that 4xx as a designed state
  // and the shell renders the gate off `me`; without this, a MUTATION
  // left the user on a screen full of a mailbox that no longer resolves.
  it.each(['NO_ACTIVE_MAILBOX', 'SELECT_MAILBOX', 'MAILBOX_NOT_OWNED'])(
    'resets the mailbox-scoped cache on %s',
    async (code) => {
      expect((await failOn(conflict(code))).resetCalls).toBeGreaterThan(0);
    },
  );

  // The READ half of the same invariant (audit 2026-08-21). The
  // mutation handler above justified leaving reads uncovered by saying
  // "the shell renders the gate off `me`" — true, except nothing
  // refetched `me`: focus refetch is off globally and `useMe` polls only
  // while syncing/deleting. So after a cross-tab disconnect the gate
  // never appeared and the always-mounted sync banner polled a dead
  // mailbox every 3s, rendering `null` on error the whole time.
  describe('read side', () => {
    async function failReadOn(
      error: unknown,
      times = 1,
    ): Promise<{ resetCalls: number; client: ReturnType<typeof makeQueryClient> }> {
      const client = makeQueryClient();
      let resetCalls = 0;
      const realInvalidate = client.invalidateQueries.bind(client);
      client.invalidateQueries = ((filters?: unknown, ...rest: unknown[]) => {
        if (filters === undefined) resetCalls += 1;
        return (realInvalidate as (...a: unknown[]) => Promise<void>)(filters, ...rest);
      }) as typeof client.invalidateQueries;

      for (let i = 0; i < times; i += 1) {
        const query = client.getQueryCache().build(client, {
          queryKey: ['scoped-read', i] as const,
          queryFn: () => Promise.reject(error),
          retry: false,
        });
        await query.fetch().catch(() => undefined);
      }
      // See the identical comment in `failOn` above — one more
      // fire-and-forget microtask hop to flush since round 4's
      // `cancelQueries()` addition to `resetMailboxScopedCache`.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { resetCalls, client };
    }

    it.each(['NO_ACTIVE_MAILBOX', 'SELECT_MAILBOX', 'MAILBOX_NOT_OWNED'])(
      'resets the mailbox-scoped cache when a READ fails with %s',
      async (code) => {
        expect((await failReadOn(conflict(code))).resetCalls).toBeGreaterThan(0);
      },
    );

    it('leaves the cache alone for a read failure that is not a scope conflict', async () => {
      expect((await failReadOn(conflict('PROTECTED_SENDER'))).resetCalls).toBe(0);
      expect((await failReadOn(new Error('network'))).resetCalls).toBe(0);
    });

    // The handler can feed itself: the reset invalidates everything,
    // those queries refetch, the guarded ones 409 again, and each
    // re-enters here. It does terminate once `me` resolves and the shell
    // swaps in the gate — but "terminates eventually" is exactly how the
    // original storm was justified, so the bound is structural.
    it('coalesces a burst of scope-conflict reads into one reset', async () => {
      const { resetCalls } = await failReadOn(conflict('NO_ACTIVE_MAILBOX'), 5);
      expect(resetCalls).toBe(1);
    });
  });

  it('leaves the cache alone for a 409 that is NOT a scope conflict', async () => {
    // Two-sided: PROTECTED_SENDER shares the status but is resolved in
    // place by the action surface, not by blowing away the cache.
    expect((await failOn(conflict('PROTECTED_SENDER'))).resetCalls).toBe(0);
  });

  it('leaves the cache alone for a connect-flow ownership rejection', async () => {
    // MAILBOX_OWNED_BY_OTHER_WORKSPACE is a connect rejection with its
    // own UI — nothing about the ACTIVE mailbox went stale.
    expect((await failOn(conflict('MAILBOX_OWNED_BY_OTHER_WORKSPACE'))).resetCalls).toBe(0);
  });

  it('leaves the cache alone for a plain network failure', async () => {
    expect((await failOn(new Error('offline'))).resetCalls).toBe(0);
  });

  it('recovers from a TRANSLATED error that carries the code (useSyncNow)', async () => {
    // Not every mutation rejects with the raw ApiError. `useSyncNow`
    // maps it to a SyncNowError carrying the same code, so an
    // envelope-only check skipped that hook entirely — the recovery has
    // to follow the code, not the class it arrived in.
    const translated = new SyncNowError('NO_ACTIVE_MAILBOX', 'No active mailbox.');
    expect((await failOn(translated)).resetCalls).toBeGreaterThan(0);
  });

  it('leaves the cache alone for a translated error with an unrelated code', async () => {
    expect((await failOn(new SyncNowError('SYNC_NOT_READY', 'Not ready.'))).resetCalls).toBe(0);
  });
});

describe('makeQueryClient — global query-failure reporting', () => {
  it('reports a client-side query defect that no screen would have captured', async () => {
    // The 2026-08-21 app-killer: a rejected query promise, not an ApiError.
    await runFailingQuery(new Error(`Missing queryFn: '["auth","me"]'`), ['auth', 'me']);
    expect(captureFeatureException).toHaveBeenCalledOnce();
    expect(captureFeatureException.mock.calls[0]?.[1]).toEqual({
      surface: 'query',
      reason: 'auth',
    });
  });

  it('reports a 5xx read failure', async () => {
    await runFailingQuery(new ApiError(503, {}, 'GET /api/senders failed: 503'), ['senders', {}]);
    expect(captureFeatureException).toHaveBeenCalledOnce();
  });

  it('stays silent for the 4xx reads the app renders as designed states', async () => {
    for (const status of [401, 402, 404, 409]) {
      await runFailingQuery(new ApiError(status, {}, `failed: ${status}`), ['senders', status]);
    }
    expect(captureFeatureException).not.toHaveBeenCalled();
  });

  it('reports a retrying surface once per window, not once per attempt', async () => {
    // `useMe` re-attempts every 15s while the app has no session; an
    // un-throttled reporter would turn one broken surface into thousands of
    // Sentry events.
    const client = makeQueryClient();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await client
        .fetchQuery({
          queryKey: ['auth', 'me'],
          queryFn: () => Promise.reject(new Error('boom')),
          retry: false,
        })
        .catch(() => undefined);
      client.removeQueries({ queryKey: ['auth', 'me'] });
    }
    expect(captureFeatureException).toHaveBeenCalledOnce();
  });

  it('throttles per surface, so one noisy surface cannot mask another', async () => {
    const client = makeQueryClient();
    for (const [index, scope] of ['auth', 'auth', 'senders', 'senders', 'brief'].entries()) {
      await client
        .fetchQuery({
          queryKey: [scope, index],
          queryFn: () => Promise.reject(new Error('boom')),
          retry: false,
        })
        .catch(() => undefined);
    }
    expect(captureFeatureException).toHaveBeenCalledTimes(3);
  });

  it('never puts anything past the query key\u2019s first segment in the tag', async () => {
    await runFailingQuery(new Error('boom'), ['senders', { domain: 'someone@example.com' }]);
    expect(captureFeatureException.mock.calls[0]?.[1]).toEqual({
      surface: 'query',
      reason: 'senders',
    });
  });
});
