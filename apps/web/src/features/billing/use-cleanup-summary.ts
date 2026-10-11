'use client';

import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';

/** Cleanup-summary hook. The query lands with the emails-cleared meter. */
export function useCleanupSummary(): { data?: CleanupSummaryDto; isLoading: boolean } {
  return { isLoading: false };
}
