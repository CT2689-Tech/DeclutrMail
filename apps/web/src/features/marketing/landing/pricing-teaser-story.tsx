'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

import type { PricingFlags } from '@/features/marketing/pricing/load-pricing-flags';

import { PricingTeaserView } from './pricing-teaser-view';

const PricingTeaserStory = dynamic(() =>
  import('./pricing-teaser-launch').then((mod) => mod.PricingTeaserStory),
);

/**
 * The landing page stays static so its metadata stays in `<head>`.
 * This island keeps today's teaser until the public catalog says the
 * launch flag is on. The launch teaser is a separate chunk.
 */
export function PricingTeaserGate() {
  const [flags, setFlags] = useState<PricingFlags | null>(null);
  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    const controller = new AbortController();
    void fetch(`${apiBase}/api/pricing/public`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body: unknown = await response.json();
        const data =
          typeof body === 'object' && body !== null && 'data' in body
            ? (body as { data?: unknown }).data
            : body;
        if (typeof data !== 'object' || data === null) return;
        const record = data as { pricingV2?: unknown; passEnabled?: unknown };
        setFlags({
          pricingV2: record.pricingV2 === true,
          passEnabled: record.passEnabled === true,
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!flags?.pricingV2) return <PricingTeaserView provider="paddle" />;
  return <PricingTeaserStory passEnabled={flags.passEnabled} />;
}
