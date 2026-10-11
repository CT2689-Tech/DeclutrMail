'use client';

import type { JSX } from 'react';

import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';

/** Preview line for a cleanup that would draw the emails-cleared meter. Null until the meter is wired. */
export function MeterPreviewLine(props: {
  requested: number;
  summary: CleanupSummaryDto;
}): JSX.Element | null {
  if (!props.summary.metered) return null;
  void props.requested;
  return null;
}
