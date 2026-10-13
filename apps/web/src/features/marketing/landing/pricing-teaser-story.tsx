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
 * The server passes its own flag so first paint matches a flags-on build.
 * Any non-200 or network failure keeps that paint: a web deploy that
 * lands before the API must not surface an error, report the miss, or
 * put the flags-off teaser back.
 */
async function readVisitorLocale(signal: AbortSignal): Promise<'inr' | 'usd'> {
  const response = await fetch('/visitor-locale', { signal, cache: 'no-store' });
  if (!response.ok) return 'usd';
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null) return 'usd';
  return (body as { locale?: unknown }).locale === 'inr' ? 'inr' : 'usd';
}

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
  const record = data as {
    pricingV2?: unknown;
    passEnabled?: unknown;
    indiaCheckoutOpen?: unknown;
  };
  return {
    pricingV2: record.pricingV2 === true,
    passEnabled: record.passEnabled === true,
    indiaCheckoutOpen: record.indiaCheckoutOpen === true,
  };
}

export function PricingTeaserGate({
  pricingV2 = false,
  passEnabled = false,
}: {
  pricingV2?: boolean;
  passEnabled?: boolean;
} = {}) {
  const [flags, setFlags] = useState<PricingFlags | null>(
    pricingV2 ? { pricingV2: true, passEnabled, indiaCheckoutOpen: false } : null,
  );
  const [locale, setLocale] = useState<'usd' | 'inr'>('usd');
  useEffect(() => {
    const controller = new AbortController();
    void readLaunchFlags(controller.signal)
      .then((next) => {
        if (next) setFlags(next);
      })
      .catch(() => undefined);
    void readVisitorLocale(controller.signal)
      .then((next) => setLocale(next))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!flags?.pricingV2) return <PricingTeaserView provider="paddle" />;
  return <PricingTeaserStory passEnabled={flags.passEnabled} locale={locale} />;
}
