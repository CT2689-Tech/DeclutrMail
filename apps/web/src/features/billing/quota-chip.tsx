'use client';

import { useEffect, useState, type JSX } from 'react';
import { usePathname } from 'next/navigation';

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
  // Pathname is the same on the server and the first client render.
  // Reading `window` here made the server href `from=/` and the client
  // href the real route. The query string is applied after mount.
  const pathname = usePathname() ?? '/';
  const [search, setSearch] = useState('');
  useEffect(() => {
    setSearch(window.location.search);
  }, [pathname]);
  const from = `${pathname}${search}`;
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
      {' \u00b7 '}
      <a
        className="dm-tap-target"
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
