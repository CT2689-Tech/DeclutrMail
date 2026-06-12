/**
 * Tests for the upgrade-gate store + 402 narrowing (D19/D77/D81).
 *
 * The narrowing must accept EXACTLY the two entitlement codes on a 402
 * and nothing else — a generic 402, a 403, or a non-ApiError must all
 * pass through untouched (they get the caller's normal error handling).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/client';

import { reportUpgradeGateHit, upgradeGateHitFrom, useUpgradeGateStore } from './upgrade-gate';

function freeCap402(details?: Record<string, unknown>) {
  return new ApiError(
    402,
    { error: { code: 'FREE_CAP_REACHED', ...(details ? { details } : {}) } },
    'POST /api/actions failed: 402',
  );
}

function inboxLimit402(details?: Record<string, unknown>) {
  return new ApiError(
    402,
    { error: { code: 'INBOX_LIMIT_REACHED', ...(details ? { details } : {}) } },
    'POST /api/auth/google/connect failed: 402',
  );
}

beforeEach(() => {
  useUpgradeGateStore.getState().dismiss();
});

describe('upgradeGateHitFrom', () => {
  it('extracts FREE_CAP_REACHED details', () => {
    const hit = upgradeGateHitFrom(
      freeCap402({ remaining: 2, limit: 5, used: 3, requiredUnits: 4 }),
    );
    expect(hit).toEqual({
      reason: 'free_cap',
      details: { remaining: 2, limit: 5, used: 3, requiredUnits: 4 },
    });
  });

  it('extracts INBOX_LIMIT_REACHED details', () => {
    const hit = upgradeGateHitFrom(inboxLimit402({ limit: 1, connected: 1, tier: 'free' }));
    expect(hit).toEqual({ reason: 'inbox_limit', details: { limit: 1, connected: 1 } });
  });

  it('falls back to D19 defaults when details are malformed', () => {
    const hit = upgradeGateHitFrom(freeCap402({ remaining: 'lots' }));
    expect(hit).toEqual({
      reason: 'free_cap',
      details: { remaining: 0, limit: 5, used: 5, requiredUnits: 1 },
    });
  });

  it('ignores other 402 codes, other statuses, and non-ApiErrors', () => {
    expect(upgradeGateHitFrom(new ApiError(402, { error: { code: 'OTHER' } }, 'x'))).toBeNull();
    expect(
      upgradeGateHitFrom(new ApiError(403, { error: { code: 'FREE_CAP_REACHED' } }, 'x')),
    ).toBeNull();
    expect(upgradeGateHitFrom(new Error('plain'))).toBeNull();
    expect(upgradeGateHitFrom(undefined)).toBeNull();
  });
});

describe('reportUpgradeGateHit', () => {
  it('reports an entitlement 402 into the store and returns true', () => {
    expect(reportUpgradeGateHit(inboxLimit402({ limit: 2, connected: 2 }))).toBe(true);
    expect(useUpgradeGateStore.getState().hit).toEqual({
      reason: 'inbox_limit',
      details: { limit: 2, connected: 2 },
    });
  });

  it('returns false and leaves the store untouched for other errors', () => {
    expect(reportUpgradeGateHit(new Error('boom'))).toBe(false);
    expect(useUpgradeGateStore.getState().hit).toBeNull();
  });

  it('dismiss clears the hit', () => {
    reportUpgradeGateHit(freeCap402());
    useUpgradeGateStore.getState().dismiss();
    expect(useUpgradeGateStore.getState().hit).toBeNull();
  });
});
