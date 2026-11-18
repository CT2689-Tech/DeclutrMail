/**
 * `/pricing.md` drift guard.
 *
 * The point of a machine-readable pricing file is that a model can trust
 * it, so the failure mode that matters is not "the file is missing" but
 * "the file quotes a price nothing charges". Every price assertion here is
 * computed FROM the pricing config, and the last one is the important one:
 * no money figure may appear in the document that the config cannot produce.
 */

import { describe, expect, it } from 'vitest';

import {
  METER,
  OFFERS,
  PLUS_ANNUAL_2026_10,
  passAmount,
  planName,
  plusAmount,
} from '@declutrmail/shared/entitlements';

import { formatUsd } from '@/features/marketing/pricing/pricing-model';
import { siteUrl } from '@/features/marketing/landing/urls';
import { GET } from './route';

async function body(): Promise<string> {
  const response = GET();
  expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
  return response.text();
}

describe('/pricing.md — machine-readable pricing', () => {
  it('keeps the machine-readable alternate crawlable but not separately indexed', () => {
    const response = GET();
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    expect(response.headers.get('Link')).toBe(`<${siteUrl()}/pricing>; rel="canonical"`);
  });

  it('names Free, the Backlog Pass and Plus at their launch prices', async () => {
    const markdown = await body();
    expect(markdown).toContain(`## ${planName('free')}`);
    expect(markdown).toContain(`## ${planName('pass')}`);
    expect(markdown).toContain(`## ${planName('plus')}`);
    expect(markdown).toContain(`${plusAmount('usd')} a year`);
    expect(markdown).toContain(`${passAmount('usd')} once`);
    expect(markdown).not.toContain('You can pay with UPI');
  });

  it('quotes no retired price', async () => {
    const markdown = await body();
    expect(markdown).not.toContain('$9/mo');
    expect(markdown).not.toContain('$90/yr');
    expect(markdown).not.toContain('Founding Pro');
    expect(markdown).toContain(
      `${METER.free.limit.toLocaleString('en-US')} emails cleared a month`,
    );
  });

  it('quotes no money figure the pricing config cannot produce', async () => {
    const markdown = await body();
    const allowedUsd = new Set(
      [0, PLUS_ANNUAL_2026_10.usdCents, OFFERS.backlogPass.price.usdCents].map(formatUsd),
    );
    const found = markdown.match(/\$[\d,]+(?:\.\d{2})?/g) ?? [];
    expect(found.length).toBeGreaterThan(0);
    for (const amount of found) {
      expect(allowedUsd.has(amount), `${amount} is not a launch price`).toBe(true);
    }
    expect(markdown).not.toMatch(/₹[\d,]+/);
  });
});
