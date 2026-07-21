'use client';

/**
 * Pending-checkout persistence (D117 double-charge guard).
 *
 * Between Paddle's `checkout.completed` and the webhook grant there is
 * no subscription row, so the BE's SUBSCRIPTION_EXISTS check cannot
 * reject a second checkout — the FE must withhold checkout affordances
 * for the whole window. React state alone is tab-local; this module
 * makes the lock survive reloads and propagate across tabs of the same
 * browser via localStorage (writes fire `storage` events in every
 * other tab).
 *
 * The lock NEVER auto-expires — a silent unlock would reopen the
 * double-charge window for exactly the user whose webhook is delayed.
 * A record that stays unconfirmed past the screen's threshold switches
 * the UI to an explicit "payment unconfirmed" state whose only release
 * is the user asserting they did not complete a payment (or the tier
 * flip clearing it). Cross-DEVICE double-checkout remains open until
 * the BE exposes a server-side pending signal (flagged in
 * FOUNDER-FOLLOWUPS — a backend change, out of this PR's scope).
 */

import type { TierId } from '@declutrmail/shared/entitlements';

export interface PendingCheckout {
  workspaceId: string;
  /** Tier at the moment of payment — the flip detector compares to it. */
  fromTier: TierId;
  /** Epoch ms of `checkout.completed`. */
  at: number;
}

/** Exported for the cross-tab `storage`-event filter. */
export const PENDING_CHECKOUT_KEY = 'dm.billing.pending-checkout';

const TIER_IDS: readonly string[] = ['free', 'plus', 'pro', 'team', 'enterprise'];

/**
 * Read the pending record for THIS workspace. Malformed records are
 * cleared; a record for a different workspace is ignored (never
 * cleared — it may be another account's live lock in this browser).
 * Age is NOT checked here — the screen renders old records as the
 * explicit "payment unconfirmed" state instead of silently unlocking.
 */
export function readPendingCheckout(workspaceId: string): PendingCheckout | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PENDING_CHECKOUT_KEY);
  } catch {
    return null; // storage unavailable (privacy mode) — lock degrades to tab-local
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearPendingCheckout();
    return null;
  }
  const record = parsed as Partial<PendingCheckout>;
  if (
    typeof record.workspaceId !== 'string' ||
    typeof record.at !== 'number' ||
    typeof record.fromTier !== 'string' ||
    !TIER_IDS.includes(record.fromTier)
  ) {
    clearPendingCheckout();
    return null;
  }
  if (record.workspaceId !== workspaceId) return null;
  return record as PendingCheckout;
}

/** Record `checkout.completed` for this workspace. Returns the record. */
export function writePendingCheckout(workspaceId: string, fromTier: TierId): PendingCheckout {
  const record: PendingCheckout = { workspaceId, fromTier, at: Date.now() };
  try {
    window.localStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(record));
  } catch {
    // Storage full/unavailable — the in-memory lock still holds this tab.
  }
  return record;
}

/** The webhook grant landed (or the record went stale) — release. */
export function clearPendingCheckout(): void {
  try {
    window.localStorage.removeItem(PENDING_CHECKOUT_KEY);
  } catch {
    // Nothing to release if storage is unavailable.
  }
}
