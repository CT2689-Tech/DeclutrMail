'use client';

/**
 * Entitlement-402 surfacing (D19/D77/D81 — U13 billing FE).
 *
 * The BE's entitlement gates return 402 with one of two codes:
 *
 *   - `FREE_CAP_REACHED`   — a Free workspace spent its 5 lifetime
 *     cleanup actions (action enqueue paths).
 *   - `INBOX_LIMIT_REACHED` — connecting another Gmail account would
 *     exceed the tier's inbox limit (connect path).
 *
 * A global TanStack `MutationCache.onError` (see `lib/query-client.ts`)
 * reports either hit into this tiny zustand store; the `<UpgradeModal>`
 * (features/billing) renders the tier-appropriate upgrade flow wherever
 * the app shell mounts it. Kept in the lib layer so the query client
 * never imports from a feature directory (D198/D199 layering).
 *
 * Supersedes the interim `free-cap` store + bottom-anchored prompt
 * (the modal-grade flow this file's predecessor promised).
 */

import { create } from 'zustand';

import { ApiError } from '@/lib/api/client';

/** Scalar context the FREE_CAP_REACHED 402 attaches to `details`. */
export interface FreeCapDetails {
  remaining: number;
  limit: number;
  used: number;
  requiredUnits: number;
}

/** Scalar context the INBOX_LIMIT_REACHED 402 attaches to `details`. */
export interface InboxLimitDetails {
  limit: number;
  connected: number;
}

/** Discriminated hit — which gate fired, with its BE-provided context. */
export type UpgradeGateHit =
  | { reason: 'free_cap'; details: FreeCapDetails }
  | { reason: 'inbox_limit'; details: InboxLimitDetails };

interface UpgradeGateState {
  /** The latest entitlement-gate hit, or null when none / dismissed. */
  hit: UpgradeGateHit | null;
  report: (hit: UpgradeGateHit) => void;
  dismiss: () => void;
}

export const useUpgradeGateStore = create<UpgradeGateState>((set) => ({
  hit: null,
  report: (hit) => set({ hit }),
  dismiss: () => set({ hit: null }),
}));

/** D19 defaults — used when a malformed envelope omits `details`. */
const FREE_CAP_FALLBACK: FreeCapDetails = { remaining: 0, limit: 5, used: 5, requiredUnits: 1 };
const INBOX_LIMIT_FALLBACK: InboxLimitDetails = { limit: 1, connected: 1 };

/**
 * Narrow an arbitrary mutation error to an entitlement 402 and extract
 * its hit. Returns null for every other failure.
 */
export function upgradeGateHitFrom(error: unknown): UpgradeGateHit | null {
  if (!(error instanceof ApiError) || error.status !== 402) return null;
  const body = error.body as
    | { error?: { code?: unknown; details?: Record<string, unknown> } }
    | undefined;
  const code = body?.error?.code;
  const d = body?.error?.details ?? {};
  if (code === 'FREE_CAP_REACHED') {
    return {
      reason: 'free_cap',
      details: {
        remaining: asCount(d['remaining'], FREE_CAP_FALLBACK.remaining),
        limit: asCount(d['limit'], FREE_CAP_FALLBACK.limit),
        used: asCount(d['used'], FREE_CAP_FALLBACK.used),
        requiredUnits: asCount(d['requiredUnits'], FREE_CAP_FALLBACK.requiredUnits),
      },
    };
  }
  if (code === 'INBOX_LIMIT_REACHED') {
    return {
      reason: 'inbox_limit',
      details: {
        limit: asCount(d['limit'], INBOX_LIMIT_FALLBACK.limit),
        connected: asCount(d['connected'], INBOX_LIMIT_FALLBACK.connected),
      },
    };
  }
  return null;
}

/**
 * Report a mutation error if (and only if) it is an entitlement 402.
 * Returns true when handled so callers can skip their generic failure
 * toast. Safe to call from any onError — other errors are ignored.
 */
export function reportUpgradeGateHit(error: unknown): boolean {
  const hit = upgradeGateHitFrom(error);
  if (!hit) return false;
  useUpgradeGateStore.getState().report(hit);
  return true;
}

function asCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
