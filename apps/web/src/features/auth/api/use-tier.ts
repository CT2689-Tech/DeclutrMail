'use client';

import { inboxLimitFor } from '@declutrmail/shared/entitlements';

import { useAuth } from '@/features/auth/auth-provider';
import type { Tier } from './use-me';

/** The FE's resolved entitlement position for the current workspace. */
export interface TierEntitlements {
  tier: Tier;
  /**
   * Free-tier LIFETIME cleanup actions left (D19: 5); `null` =
   * unlimited (every paid tier). Served by `/api/auth/me`.
   */
  cleanupRemaining: number | null;
  /** Connected-Gmail-account ceiling for the tier (D19 manifest). */
  inboxLimit: number;
  /** Mailboxes currently connected (status='active'). */
  connectedInboxes: number;
  /**
   * True when ADDING another Gmail account is blocked (connected ≥
   * limit). Existing connections keep working even over-limit —
   * enforcement is on adding only (mirrors the BE InboxLimitGuard).
   */
  atInboxLimit: boolean;
}

/**
 * `useTier` / `useEntitlements` — the workspace tier + quota position
 * (D19/D77/D81), derived from the already-loaded `me` query plus the
 * shared entitlement manifest. No extra network round-trip; limits
 * come from `@declutrmail/shared/entitlements` so FE and BE can never
 * disagree on a number.
 *
 * Must render under `AuthProvider` (it reads `useAuth()`).
 */
export function useTier(): TierEntitlements {
  const { me } = useAuth();
  // Web (Vercel) and API (Cloud Run) deploy independently — during the
  // skew window `/api/auth/me` may predate the tier fields. Fall back
  // instead of crashing the shell on TIER_MANIFEST[undefined].
  const tier = me.tier ?? 'free';
  const inboxLimit = inboxLimitFor(tier);
  const connectedInboxes = me.mailboxes.filter((m) => m.status === 'active').length;
  return {
    tier,
    cleanupRemaining: me.cleanupRemaining ?? null,
    inboxLimit,
    connectedInboxes,
    atInboxLimit: connectedInboxes >= inboxLimit,
  };
}

/** Alias — some call sites read better as `useEntitlements()`. */
export const useEntitlements = useTier;
