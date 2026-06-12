'use client';

/**
 * Free-cleanup-cap 402 surfacing (D19/D77).
 *
 * The action enqueue paths return 402 `FREE_CAP_REACHED` once a Free
 * workspace has spent its 5 lifetime cleanup actions. The action hooks
 * (`lib/api/use-action.ts`) report the hit into this tiny zustand
 * store; the `<FreeCapPrompt>` component (features/billing) renders a
 * non-blocking inline upgrade prompt wherever it is mounted. Kept in
 * the lib layer so the feature-agnostic hooks never import from a
 * feature directory (D198/D199 layering).
 */

import { create } from 'zustand';

import { ApiError } from '@/lib/api/client';

/** Scalar context the BE attaches to the 402 envelope's `details`. */
export interface FreeCapDetails {
  remaining: number;
  limit: number;
  used: number;
  requiredUnits: number;
}

interface FreeCapState {
  /** The latest cap hit, or null when none / dismissed. */
  hit: FreeCapDetails | null;
  report: (details: FreeCapDetails) => void;
  dismiss: () => void;
}

export const useFreeCapStore = create<FreeCapState>((set) => ({
  hit: null,
  report: (details) => set({ hit: details }),
  dismiss: () => set({ hit: null }),
}));

/** D19 default — used when a malformed envelope omits `details`. */
const FALLBACK_DETAILS: FreeCapDetails = { remaining: 0, limit: 5, used: 5, requiredUnits: 1 };

/**
 * Narrow an action-hook error to the FREE_CAP_REACHED 402 and extract
 * its `details`. Returns null for every other failure.
 */
export function freeCapDetailsFrom(error: unknown): FreeCapDetails | null {
  if (!(error instanceof ApiError) || error.status !== 402) return null;
  const body = error.body as
    | { error?: { code?: unknown; details?: Record<string, unknown> } }
    | undefined;
  if (body?.error?.code !== 'FREE_CAP_REACHED') return null;
  const d = body.error.details ?? {};
  return {
    remaining: asCount(d['remaining'], FALLBACK_DETAILS.remaining),
    limit: asCount(d['limit'], FALLBACK_DETAILS.limit),
    used: asCount(d['used'], FALLBACK_DETAILS.used),
    requiredUnits: asCount(d['requiredUnits'], FALLBACK_DETAILS.requiredUnits),
  };
}

/**
 * Report a mutation error if (and only if) it is the free-cap 402.
 * Returns true when handled so callers can skip their generic failure
 * toast. Safe to call from any onError — non-cap errors are ignored.
 */
export function reportFreeCapHit(error: unknown): boolean {
  const details = freeCapDetailsFrom(error);
  if (!details) return false;
  useFreeCapStore.getState().report(details);
  return true;
}

function asCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
