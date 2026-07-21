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

import type { BillingCycle } from '@declutrmail/shared/contracts';
import type { TierId } from '@declutrmail/shared/entitlements';

/**
 * What started the wait — drives the notice copy. `change_unconfirmed`
 * is a plan change whose provider RESPONSE was lost (ambiguous outcome:
 * the prorated charge may have applied) — same lock + poll, but the
 * copy must not claim the provider accepted anything.
 */
export type PendingKind = 'checkout' | 'change' | 'change_unconfirmed' | 'resume';

export interface PendingCheckout {
  workspaceId: string;
  /** What started the wait (overlay payment / plan change / resume). */
  kind: PendingKind;
  /** Tier at the moment of the action — the flip detector compares to it. */
  fromTier: TierId;
  /** Billing cycle at the moment of the action — cycle-only plan
   *  changes flip THIS while the tier stays put. Null when there was
   *  no subscription to change (fresh checkout). */
  fromCycle: BillingCycle | null;
  /** Exact server state that acknowledges this action. */
  toTier: TierId;
  toCycle: BillingCycle | null;
  /** Epoch ms of the triggering action. */
  at: number;
}

/** Prefix only; each workspace owns an independent browser lock. */
export const PENDING_CHECKOUT_KEY = 'dm.billing.pending-checkout';
export function pendingCheckoutKey(workspaceId: string): string {
  return `${PENDING_CHECKOUT_KEY}:${workspaceId}`;
}

const TIER_IDS: readonly string[] = ['free', 'plus', 'pro', 'team', 'enterprise'];
const KINDS: readonly string[] = ['checkout', 'change', 'change_unconfirmed', 'resume'];
const CYCLES: readonly string[] = ['monthly', 'annual'];

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
    raw = window.localStorage.getItem(pendingCheckoutKey(workspaceId));
  } catch {
    return null; // storage unavailable (privacy mode) — lock degrades to tab-local
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearPendingCheckout(workspaceId);
    return null;
  }
  const record = parsed as Partial<PendingCheckout>;
  if (
    typeof record.workspaceId !== 'string' ||
    typeof record.at !== 'number' ||
    typeof record.fromTier !== 'string' ||
    !TIER_IDS.includes(record.fromTier) ||
    typeof record.kind !== 'string' ||
    !KINDS.includes(record.kind) ||
    (record.fromCycle !== null && !CYCLES.includes(record.fromCycle as string)) ||
    typeof record.toTier !== 'string' ||
    !TIER_IDS.includes(record.toTier) ||
    (record.toCycle !== null && !CYCLES.includes(record.toCycle as string))
  ) {
    clearPendingCheckout(workspaceId);
    return null;
  }
  if (record.workspaceId !== workspaceId) return null;
  return record as PendingCheckout;
}

/** Record the pending action for this workspace. Returns the record. */
export function writePendingCheckout(
  workspaceId: string,
  kind: PendingKind,
  fromTier: TierId,
  fromCycle: BillingCycle | null,
  toTier: TierId,
  toCycle: BillingCycle | null,
): PendingCheckout {
  const record: PendingCheckout = {
    workspaceId,
    kind,
    fromTier,
    fromCycle,
    toTier,
    toCycle,
    at: Date.now(),
  };
  try {
    window.localStorage.setItem(pendingCheckoutKey(workspaceId), JSON.stringify(record));
  } catch {
    // Storage full/unavailable — the in-memory lock still holds this tab.
  }
  return record;
}

/** The webhook grant landed (or the user explicitly released it). */
export function clearPendingCheckout(workspaceId: string): void {
  try {
    window.localStorage.removeItem(pendingCheckoutKey(workspaceId));
  } catch {
    // Nothing to release if storage is unavailable.
  }
}
