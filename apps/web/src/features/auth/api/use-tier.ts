'use client';

import { BACKLOG_PASS_NAME } from '@declutrmail/shared/copy/screen-decisions';
import { inboxLimitFor, TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { useAuth } from '@/features/auth/auth-provider';
import type { Tier } from './use-me';

/** The FE's resolved entitlement position for the current workspace. */
export interface TierEntitlements {
  tier: Tier;
  /**
   * Emails left on Free's meter THIS PERIOD; `null` = unlimited (every
   * paid tier). Served by `/api/auth/me`.
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
  /**
   * Whose ceiling `inboxLimit` is, for "<name> includes N Gmail accounts":
   * the Backlog Pass, the stored plan when the limit is that plan's, else
   * "Your plan". `tier` and `inboxLimit` are separate server reads — a
   * lapsed Pass drops the limit hours before the stored tier follows.
   */
  inboxLimitOwner: string;
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
  // The server's ceiling when it sends one, else the manifest's.
  const inboxLimit = me.inboxLimit ?? inboxLimitFor(tier);
  const inboxLimitOwner =
    me.inboxLimitReason === 'pass'
      ? BACKLOG_PASS_NAME
      : inboxLimit === inboxLimitFor(tier)
        ? TIER_MANIFEST[tier].name
        : 'Your plan';
  const connectedInboxes = me.mailboxes.filter((m) => m.status === 'active').length;
  return {
    tier,
    cleanupRemaining: me.cleanupRemaining ?? null,
    cleanupResetsAt: me.cleanupResetsAt ?? null,
    inboxLimit,
    ...(me.inboxLimitReason === 'pass' ? { inboxLimitReason: 'pass' as const } : {}),
    inboxLimitOwner,
    connectedInboxes,
    atInboxLimit: connectedInboxes >= inboxLimit,
  };
}

/** Alias — some call sites read better as `useEntitlements()`. */
export const useEntitlements = useTier;
