'use client';

import type { JSX } from 'react';

import { tokens } from '@declutrmail/shared';
import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';
import { fillStory, meterChipLine } from '@declutrmail/shared/entitlements';

import { track } from '@/lib/posthog';

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
  const from =
    typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`;
  return (
    <>
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
      <a
        href={`/billing?from=${encodeURIComponent(from)}`}
        onClick={() => {
          void track('upgrade_cta_clicked', { source: 'quota_chip', plan: 'plus' });
        }}
      >
        {fillStory(WS1_COPY['meter.chip.link'])}
      </a>
    </>
  );
}
