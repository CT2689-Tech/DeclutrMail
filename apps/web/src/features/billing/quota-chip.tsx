'use client';

import type { JSX } from 'react';

import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';

/** Renders nothing until the meter is on, and nothing when the workspace is not metered. */
export function QuotaChip(props: {
  summary: CleanupSummaryDto;
  compact?: boolean;
}): JSX.Element | null {
  if (!props.summary.metered) return null;
  void props.compact;
  return null;
}
