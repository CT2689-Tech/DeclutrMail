/**
 * Tests for `makeQueryClient` (D200) — specifically the U13 global
 * MutationCache handler: an entitlement 402 from ANY mutation must
 * land in the upgrade-gate store (the UpgradeModal's data source)
 * without per-hook wiring; every other failure must leave it alone.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/client';
import { useUpgradeGateStore } from '@/lib/entitlements/upgrade-gate';

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

  it('leaves the store untouched for non-entitlement failures', async () => {
    await runFailingMutation(new ApiError(500, { error: { code: 'INTERNAL_ERROR' } }, 'boom'));
    await runFailingMutation(new Error('network down'));
    expect(useUpgradeGateStore.getState().hit).toBeNull();
  });
});
