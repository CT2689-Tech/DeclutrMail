'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

import type { PricingFlags } from '@/features/marketing/pricing/load-pricing-flags';

import { PricingTeaserView } from './pricing-teaser-view';

const PricingTeaserStory = dynamic(() =>
  import('./pricing-teaser-launch').then((mod) => mod.PricingTeaserStory),
);

/**
 * Read the public catalog. The landing page stays static so its metadata
 * stays in `<head>`; this island keeps today's teaser until that catalog
 * says the launch flag is on. The launch teaser is a separate chunk.
 * Any non-200 or network failure stays on today's teaser: a web deploy
 * that lands before the API must not surface an error or report the miss.
 */
async function readLaunchFlags(signal: AbortSignal): Promise<PricingFlags | null> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
  const response = await fetch(`${apiBase}/api/pricing/public`, { signal });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  const data =
    typeof body === 'object' && body !== null && 'data' in body
      ? (body as { data?: unknown }).data
      : body;
  if (typeof data !== 'object' || data === null) return null;
  const record = data as { pricingV2?: unknown; passEnabled?: unknown };
  return {
    pricingV2: record.pricingV2 === true,
    passEnabled: record.passEnabled === true,
  };
}

export function PricingTeaserGate() {
  const [flags, setFlags] = useState<PricingFlags | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void readLaunchFlags(controller.signal)
      .then((next) => {
        if (next) setFlags(next);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!flags?.pricingV2) return <PricingTeaserView provider="paddle" />;
  return <PricingTeaserStory passEnabled={flags.passEnabled} />;
}
