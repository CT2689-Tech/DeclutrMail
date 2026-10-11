'use client';

import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';
import { QuotaChip } from '@/features/billing/quota-chip';

/**
 * Mounts WS1's chip. The chip paints the deck sentence from the server
 * summary and renders nothing when the workspace is not metered.
 */
export function QuotaChipSlot({
  summary,
  compact = false,
}: {
  summary: CleanupSummaryDto | null | undefined;
  compact?: boolean;
}) {
  if (!summary?.metered) return null;
  return <QuotaChip summary={summary} {...(compact ? { compact: true } : {})} />;
}
