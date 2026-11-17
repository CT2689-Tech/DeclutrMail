'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

const PricingTeaserStory = dynamic(() =>
  import('./pricing-teaser-launch').then((mod) => mod.PricingTeaserStory),
);

/**
 * The landing page stays static so its metadata stays in `<head>`, so
 * the visitor's price locale is read after paint. Any non-200 or
 * network failure keeps dollar prices: the teaser must not surface an
 * error or report the miss.
 */
async function readVisitorLocale(signal: AbortSignal): Promise<'inr' | 'usd'> {
  const response = await fetch('/visitor-locale', { signal, cache: 'no-store' });
  if (!response.ok) return 'usd';
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null) return 'usd';
  return (body as { locale?: unknown }).locale === 'inr' ? 'inr' : 'usd';
}

export function PricingTeaserGate() {
  const [locale, setLocale] = useState<'usd' | 'inr'>('usd');
  useEffect(() => {
    const controller = new AbortController();
    void readVisitorLocale(controller.signal)
      .then((next) => setLocale(next))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return <PricingTeaserStory locale={locale} />;
}
