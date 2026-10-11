'use client';

import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';

import { useOptionalAuth } from '@/features/auth/auth-provider';

/**
 * Emails-cleared position from `GET /api/auth/me`.
 * Absent meter fields (an older API, or the flag off) leave the chip unmetered.
 */
export function useCleanupSummary(): { data?: CleanupSummaryDto; isLoading: boolean } {
  const auth = useOptionalAuth();
  if (!auth) return { isLoading: false };
  const me = auth.me;
  if (
    me.meterV2 !== true ||
    me.cleanupLimit == null ||
    me.cleanupRemaining == null ||
    !me.cleanupResetsAt
  ) {
    return { isLoading: false };
  }
  return {
    isLoading: false,
    data: {
      metered: true,
      limit: me.cleanupLimit,
      used: me.cleanupUsed ?? Math.max(0, me.cleanupLimit - me.cleanupRemaining),
      remaining: me.cleanupRemaining,
      resetAt: me.cleanupResetsAt,
    },
  };
}
