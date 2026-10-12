import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildOffersJsonLd,
  indiaFaqAnswer,
  isBillingPassEnabled,
  isPricingV2,
  meterChipLine,
  meterPreviewText,
  moneyAmount,
  passEndLabel,
  priceLine,
  promoBanner,
  promoEndLabel,
  quotaUnitsForEnqueue,
  renderPricingMarkdown,
  suggestedWindowPreset,
  termsPastDue,
} from './copy';
import { OFFERS, PLUS_ANNUAL_2026_10 } from './pricing.config';
import { WS1_COPY } from '../copy/launch';
import { POLICY } from './pricing.config';

describe('isPricingV2', () => {
  const previous = process.env.PRICING_V2;

  function restore(): void {
    if (previous === undefined) delete process.env.PRICING_V2;
    else process.env.PRICING_V2 = previous;
  }

  it('is on only when the server env is the string true', () => {
    delete process.env.PRICING_V2;
    expect(isPricingV2()).toBe(false);
    process.env.PRICING_V2 = 'false';
    expect(isPricingV2()).toBe(false);
    process.env.PRICING_V2 = 'true';
    expect(isPricingV2()).toBe(true);
    restore();
  });

  it('does not read a public Next flag', () => {
    const source = readFileSync(new URL('./copy.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('NEXT_PUBLIC_');
  });
});

describe('emails-cleared meter helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('stamps free archive and delete emails only while the meter is on', () => {
    expect(quotaUnitsForEnqueue({ tier: 'free', verb: 'archive', requestedCount: 12 })).toBe(0);
    vi.stubEnv('METER_V2', 'true');
    expect(quotaUnitsForEnqueue({ tier: 'free', verb: 'archive', requestedCount: 12 })).toBe(12);
    expect(quotaUnitsForEnqueue({ tier: 'free', verb: 'delete', requestedCount: 3 })).toBe(3);
    expect(quotaUnitsForEnqueue({ tier: 'plus', verb: 'delete', requestedCount: 12 })).toBe(0);
    expect(quotaUnitsForEnqueue({ tier: 'free', verb: 'unsubscribe', requestedCount: 2 })).toBe(0);
    expect(quotaUnitsForEnqueue({ tier: 'free', verb: 'later', requestedCount: 4 })).toBe(0);
    expect(quotaUnitsForEnqueue({ tier: 'free', verb: 'keep', requestedCount: 4 })).toBe(0);
  });

  it('picks the largest window whose preview count fits', () => {
    expect(suggestedWindowPreset(100, { 30: 80, 90: 400, 180: 1200, 365: 2708 })).toBe(30);
    expect(suggestedWindowPreset(500, { 30: 80, 90: 400, 180: 1200, 365: 2708 })).toBe(90);
    expect(suggestedWindowPreset(10, { 30: 80, 90: 0 })).toBeNull();
  });

  it('keeps September and currency text identical on every runtime', () => {
    expect(passEndLabel('2026-09-15T00:00:00.000Z')).toBe('Sep 15');
    expect(
      meterChipLine({ remaining: 640, limit: 1000, resetAt: '2026-09-15T00:00:00.000Z' }).text,
    ).toContain('resets Sep 15');
    expect(moneyAmount(PLUS_ANNUAL_2026_10.usdCents, 'usd')).toBe('$59');
    expect(moneyAmount(PLUS_ANNUAL_2026_10.inrPaise, 'inr')).toBe('₹1,999');
    expect(priceLine(OFFERS.backlogPass.price, 'usd')).toBe('$19');
    expect(priceLine(PLUS_ANNUAL_2026_10, 'inr')).toBe('₹1,999 incl. GST');
    expect(promoEndLabel()).toBe('Nov 3, 11:59 PM PT');
    for (const value of [
      moneyAmount(5900, 'usd'),
      passEndLabel('2026-09-15T00:00:00.000Z'),
      promoEndLabel(),
    ]) {
      expect(value).not.toMatch(/[\u00a0\u202f]/);
      expect(value).not.toContain('Sept');
    }
  });

  it('fills the chip and preview from the deck', () => {
    expect(
      meterChipLine({ remaining: 640, limit: 1000, resetAt: '2026-11-09T00:00:00.000Z' }).text,
    ).toBe('640 of 1,000 free emails left \u00b7 resets Nov 9');
    expect(meterPreviewText(2708, 100)).toBe(
      'This clears 2,708 emails. You have 100 free left this month.',
    );
    expect(meterPreviewText(1, 100)).toBe('This clears 1 email. You have 100 free this month.');
  });
});

describe('promoBanner', () => {
  const start = new Date('2026-10-27T07:01:00Z');
  const end = new Date('2026-11-04T07:59:00Z');

  it('is hidden before startsAt and at or after endsAt', () => {
    expect(promoBanner(new Date(start.getTime() - 1), true)).toBeNull();
    expect(promoBanner(end, true)).toBeNull();
    expect(promoBanner(new Date(end.getTime() + 1), false)).toBeNull();
  });

  it('fills the deck sentence inside the window', () => {
    const on = promoBanner(start, true);
    expect(on).toContain(promoEndLabel());
    expect(on).toContain('PH30');
    expect(on).toMatch(/^Launch offer:/);
    expect(on).not.toContain('Launch week');
    expect(on).not.toMatch(/\$\d/);
    expect(promoBanner(start, false)).not.toContain('Backlog Pass');
  });
});

describe('pricing story builders', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns no offers while the flag is off', () => {
    vi.stubEnv('PRICING_V2', '');
    expect(buildOffersJsonLd({ plus: true, pass: true })).toEqual([]);
    expect(renderPricingMarkdown(true)).toBe('');
  });

  it('snapshots listed JSON-LD and markdown while the flag is on', () => {
    vi.stubEnv('PRICING_V2', 'true');
    expect(buildOffersJsonLd()).toEqual([
      { '@type': 'Offer', name: 'Free', price: 0, priceCurrency: 'USD', url: '/pricing' },
    ]);
    const listed = buildOffersJsonLd({ plus: true, pass: true });
    expect(listed).toHaveLength(4);
    expect(listed[1]).toMatchObject({
      priceCurrency: 'USD',
      priceSpecification: { billingDuration: 'P1Y' },
    });
    expect(listed[2]).toMatchObject({ priceCurrency: 'INR', price: 1999 });
    expect(listed[3]).toEqual({
      '@type': 'Offer',
      name: 'Backlog Pass',
      price: 19,
      priceCurrency: 'USD',
    });
    expect(JSON.stringify(listed)).not.toContain('Pro');
    const markdown = renderPricingMarkdown(true);
    expect(markdown).toContain('1,000 emails cleared a month');
    expect(markdown).toContain('Backlog Pass');
    expect(WS1_COPY['pricing.pass.features']).toEqual([
      'No monthly limit for 30 days',
      'The Screener and Autopilot while it lasts',
      'Buy again any time to add {passDays} more days',
      'Then you’re back on {freeName}. Email you cleared stays where you put it.',
    ]);
    const passBlock = markdown.slice(
      markdown.indexOf('## Backlog Pass'),
      markdown.indexOf('## Plus'),
    );
    const passLines = [
      '- No monthly limit for 30 days',
      '- The Screener and Autopilot while it lasts',
      '- Buy again any time to add 30 more days',
      '- Then you’re back on Free. Email you cleared stays where you put it.',
    ];
    let cursor = -1;
    for (const line of passLines) {
      const at = passBlock.indexOf(line);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(passBlock).not.toContain('{passDays}');
    expect(passBlock).not.toContain('{freeName}');
    expect(markdown).not.toContain('No monthly limit while it lasts');
    expect(markdown).not.toContain('Autopilot and Autopilot');
    expect(renderPricingMarkdown(false)).not.toContain('## Backlog Pass');
  });

  it('derives the India pass-off answer and the dunning window', () => {
    expect(indiaFaqAnswer(false)).not.toContain('Backlog Pass');
    expect(indiaFaqAnswer(true)).toContain('Backlog Pass');
    expect(termsPastDue()).toContain(`${POLICY.dunningDays} days`);
  });

  it('reads BILLING_PASS_ENABLED only as the string true', () => {
    vi.stubEnv('BILLING_PASS_ENABLED', 'false');
    expect(isBillingPassEnabled()).toBe(false);
    vi.stubEnv('BILLING_PASS_ENABLED', 'true');
    expect(isBillingPassEnabled()).toBe(true);
  });
});
