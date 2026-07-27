/**
 * Tests for `makeQueryClient` (D200) — specifically the U13 global
 * MutationCache handler: an entitlement 402 from ANY mutation must
 * land in the upgrade-gate store (the UpgradeModal's data source)
 * without per-hook wiring; every other failure must leave it alone.
 */

import { beforeEach, describe, expect, it } from 'vitest';

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
});

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
