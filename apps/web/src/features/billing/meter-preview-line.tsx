'use client';

import type { JSX } from 'react';

import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';
import { meterPreviewText } from '@declutrmail/shared/entitlements';

/** Preview line for a cleanup that would draw the emails-cleared meter. */
export function MeterPreviewLine(props: {
  requested: number;
  summary: CleanupSummaryDto;
}): JSX.Element | null {
  if (!props.summary.metered) return null;
  return (
    <p data-testid="meter-preview-line">
      {meterPreviewText(props.requested, props.summary.remaining)}
    </p>
  );
}
