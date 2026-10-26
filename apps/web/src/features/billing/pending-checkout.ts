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
 * the prorated charge may have applied). `checkout_intent` is a fresh
 * checkout's RESERVATION: written atomically at claim time, BEFORE the
 * overlay opens, so a second tab cannot open a second payment surface;
 * it resolves to `checkout` on `checkout.completed`, releases on
 * close-without-payment, and if the tab dies it surfaces with
 * outcome-neutral copy (the user may or may not have paid).
 */
export type PendingKind =
  'checkout' | 'checkout_intent' | 'change' | 'change_unconfirmed' | 'resume';

export interface PendingCheckout {
  workspaceId: string;
  serverAttemptId?: string;
  returnTo?: string;
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
  /**
   * Purchase this lock is waiting on. Absent on a tier checkout and on
   * rows stored before the field existed. A Backlog Pass is not a
   * subscription, so the tier flip cannot see it.
   */
  offer?: 'pass_onetime';
  /** Epoch ms of the triggering action. */
  at: number;
  /**
   * Unique id of the pessimistic change ATTEMPT that wrote this record
   * (absent on user-visible locks written by startPending). The key is
   * one per workspace (last-writer-wins), so a known outcome may only
   * release the lock ITS OWN attempt wrote — target/cycle matching is
   * not unique when two attempts share a target.
   */
  attemptId?: string;
}

/** Prefix only; each workspace owns an independent browser lock. */
export const PENDING_CHECKOUT_KEY = 'dm.billing.pending-checkout';
export function pendingCheckoutKey(workspaceId: string): string {
  return `${PENDING_CHECKOUT_KEY}:${workspaceId}`;
}

const TIER_IDS: readonly string[] = ['free', 'plus', 'pro', 'team', 'enterprise'];
const KINDS: readonly string[] = [
  'checkout',
  'checkout_intent',
  'change',
  'change_unconfirmed',
  'resume',
];
const CYCLES: readonly string[] = ['monthly', 'annual'];
// Tab-local fallback only for storage failures, never for an actually removed record.
const lastKnown = new Map<string, PendingCheckout>();
const failedWrites = new Set<string>();

/**
 * Read the pending record for THIS workspace. Malformed records are
 * cleared; a record for a different workspace is ignored (never
 * cleared — it may be another account's live lock in this browser).
 * Age is NOT checked here — the screen renders old records as the
 * explicit "payment unconfirmed" state instead of silently unlocking.
 */
export function readPendingCheckout(workspaceId: string): PendingCheckout | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(pendingCheckoutKey(workspaceId));
  } catch {
    return lastKnown.get(workspaceId) ?? null;
  }
  if (!raw) {
    if (failedWrites.has(workspaceId)) return lastKnown.get(workspaceId) ?? null;
    lastKnown.delete(workspaceId);
    return null;
  }
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
    (record.toCycle !== null && !CYCLES.includes(record.toCycle as string)) ||
    (record.returnTo !== undefined && typeof record.returnTo !== 'string') ||
    (record.serverAttemptId !== undefined &&
      (typeof record.serverAttemptId !== 'string' ||
        !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(record.serverAttemptId))) ||
    (record.attemptId !== undefined && typeof record.attemptId !== 'string') ||
    (record.offer !== undefined && record.offer !== 'pass_onetime')
  ) {
    clearPendingCheckout(workspaceId);
    return null;
  }
  if (record.workspaceId !== workspaceId) return null;
  const offer = record.offer === 'pass_onetime' ? record.offer : undefined;
  const stored: PendingCheckout = {
    ...(record as PendingCheckout),
    ...(offer !== undefined ? { offer } : {}),
  };
  if (offer === undefined) delete stored.offer;
  lastKnown.set(workspaceId, stored);
  failedWrites.delete(workspaceId);
  return stored;
}

/** Record the pending action for this workspace. Returns the record. */
export function writePendingCheckout(
  workspaceId: string,
  kind: PendingKind,
  fromTier: TierId,
  fromCycle: BillingCycle | null,
  toTier: TierId,
  toCycle: BillingCycle | null,
  attemptId?: string,
  offer?: 'pass_onetime',
  returnTo?: string,
): PendingCheckout {
  const record: PendingCheckout = {
    workspaceId,
    kind,
    fromTier,
    fromCycle,
    toTier,
    toCycle,
    at: Date.now(),
    ...(attemptId !== undefined ? { attemptId } : {}),
    ...(offer === 'pass_onetime' ? { offer } : {}),
    ...(returnTo ? { returnTo } : {}),
  };
  lastKnown.set(workspaceId, record);
  try {
    window.localStorage.setItem(pendingCheckoutKey(workspaceId), JSON.stringify(record));
    failedWrites.delete(workspaceId);
  } catch {
    failedWrites.add(workspaceId);
    // Storage full/unavailable — the in-memory lock still holds this tab.
  }
  return record;
}

/** The webhook grant landed (or the user explicitly released it). */
export function clearPendingCheckout(workspaceId: string): void {
  lastKnown.delete(workspaceId);
  failedWrites.delete(workspaceId);
  try {
    window.localStorage.removeItem(pendingCheckoutKey(workspaceId));
  } catch {
    // Nothing to release if storage is unavailable.
  }
}

/**
 * Cross-tab mutual exclusion around the read-check-write of the pending
 * slot. localStorage has no compare-and-swap, so two tabs firing in the
 * same instant could both read "no lock" and both proceed with a money
 * action. The Web Locks API is the real primitive: `ifAvailable` makes
 * the claim atomic across every tab of this origin — a tab that finds
 * the mutex held STANDS DOWN (`acquired: false`) instead of waiting,
 * because whoever holds it is mid-money-action. Where the API is
 * unavailable (old browsers, non-window contexts) this degrades to the
 * plain non-atomic call — the durable record still guards everything
 * slower than the same-instant race, and the server-side pending signal
 * (FOUNDER-FOLLOWUPS) is the true cross-device fix.
 */
export async function withMoneyActionMutex<T>(
  workspaceId: string,
  fn: () => T | Promise<T>,
): Promise<{ acquired: boolean; result?: T }> {
  const locks =
    typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : undefined;
  if (!locks) {
    return { acquired: true, result: await fn() };
  }
  return locks.request(
    `${PENDING_CHECKOUT_KEY}.mutex:${workspaceId}`,
    { ifAvailable: true },
    async (lock) => (lock === null ? { acquired: false } : { acquired: true, result: await fn() }),
  );
}

/** Bind the browser reservation to the identity returned by the server. */
export function bindPendingCheckoutAttempt(
  workspaceId: string,
  attemptId: string,
): PendingCheckout | null {
  const record = readPendingCheckout(workspaceId);
  if (!record || record.attemptId !== attemptId) return null;
  const bound = { ...record, serverAttemptId: attemptId };
  lastKnown.set(workspaceId, bound);
  try {
    window.localStorage.setItem(pendingCheckoutKey(workspaceId), JSON.stringify(bound));
  } catch {
    failedWrites.add(workspaceId);
  }
  return bound;
}
