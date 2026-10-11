'use client';

import type { JSX } from 'react';

import { tokens } from '@declutrmail/shared';
import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';
import { meterChipLine } from '@declutrmail/shared/entitlements';

const AMBER_AT = 0.8;

/** Free emails-cleared chip. Renders nothing when the workspace is not metered. */
export function QuotaChip(props: {
  summary: CleanupSummaryDto;
  compact?: boolean;
}): JSX.Element | null {
  if (!props.summary.metered) return null;
  const line = meterChipLine({
    remaining: props.summary.remaining,
    limit: props.summary.limit,
    resetAt: props.summary.resetAt,
    ...(props.compact ? { compact: true } : {}),
  });
  const amber = props.summary.limit > 0 && props.summary.used / props.summary.limit >= AMBER_AT;
  return (
    <span
      data-testid="quota-chip"
      data-tone={amber ? 'amber' : 'default'}
      aria-label={line.aria}
      style={{
        color: amber ? tokens.color.amber : tokens.color.fg,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {line.text}
    </span>
  );
}
