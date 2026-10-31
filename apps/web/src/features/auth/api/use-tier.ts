'use client';

import { INBOXES, inboxLimitFor } from '@declutrmail/shared/entitlements';

import { useAuth } from '@/features/auth/auth-provider';
import type { Tier } from './use-me';

/** The FE's resolved entitlement position for the current workspace. */
export interface TierEntitlements {
  tier: Tier;
  /**
   * Cleanup actions left THIS PERIOD (A3: Free = 50/month); `null` =
   * unlimited (every paid tier). Served by `/api/auth/me`.
   */
  cleanupRemaining: number | null;
  /**
   * Next anniversary reset (ISO), server-computed — the browser never
   * derives it (A3). `null` = unlimited tier or pre-A3 API skew.
   */
  cleanupResetsAt: string | null;
  /** Connected-Gmail-account ceiling for the tier (D19 manifest). */
  inboxLimit: number;
  /** Present when a live Backlog Pass is what set the one-account ceiling. */
  inboxLimitReason?: 'pass';
  /** Launch pricing flag, from `/api/auth/me`. */
  pricingV2: boolean;
  /** Backlog Pass checkout flag, from `/api/auth/me`. Absent means hidden. */
  passEnabled: boolean;
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
  const pricingV2 = me.pricingV2 === true;
  // The server's ceiling when it sends one. Otherwise read launch pricing
  // from `me`: the browser has no PRICING_V2 env, so `inboxLimitFor`
  // alone fell back to the legacy one-account Plus.
  const inboxLimit =
    me.inboxLimit ??
    (pricingV2 && (tier === 'free' || tier === 'plus' || tier === 'pro')
      ? INBOXES[tier]
      : inboxLimitFor(tier));
  const passEnabled = me.passEnabled === true;
  const connectedInboxes = me.mailboxes.filter((m) => m.status === 'active').length;
  return {
    tier,
    cleanupRemaining: me.cleanupRemaining ?? null,
    cleanupResetsAt: me.cleanupResetsAt ?? null,
    inboxLimit,
    ...(me.inboxLimitReason === 'pass' ? { inboxLimitReason: 'pass' as const } : {}),
    pricingV2,
    passEnabled,
    connectedInboxes,
    atInboxLimit: connectedInboxes >= inboxLimit,
  };
}

/** Alias — some call sites read better as `useEntitlements()`. */
export const useEntitlements = useTier;
