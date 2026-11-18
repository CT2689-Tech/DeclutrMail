import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { INR_CHECKOUT_PAUSED_MESSAGE } from '../contracts/billing-availability';
import {
  buildOffersJsonLd,
  fillStory,
  indiaFaqAnswer,
  passSecondAccountCta,
  passSecondAccountMessage,
  passSecondAccountTitle,
  planName,
  meterChipLine,
  meterPreviewText,
  quotaExceededMessage,
  moneyAmount,
  passEndLabel,
  launchPriceDisplay,
  plusAmount,
  priceLine,
  promoBanner,
  promoEndLabel,
  quotaUnitsForEnqueue,
  renderPricingMarkdown,
  suggestedWindowPreset,
  termsPastDue,
} from './copy';
import {
  INBOXES,
  OFFERS,
  PLUS_ANNUAL_2026_10,
  indiaPaddlePricesConfigured,
} from './pricing.config';
import { WS1_COPY } from '../copy/launch';
import { POLICY } from './pricing.config';

describe('pricing copy source', () => {
  it('reads no env flag', () => {
    const source = readFileSync(new URL('./copy.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('NEXT_PUBLIC_');
    expect(source).not.toMatch(/PRICING_V2|METER_V2|BILLING_PASS_ENABLED/);
  });
});

describe('emails-cleared meter helpers', () => {
  it('stamps Free archive and delete emails only', () => {
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
    expect(launchPriceDisplay('usd')).toEqual({
      free: { amount: '$0', per: '' },
      plus: { amount: '$59', per: '/yr' },
      plusLine: '$59 a year',
      passLine: '$19 once',
    });
    expect(launchPriceDisplay('inr')).toEqual({
      free: { amount: '₹0', per: '' },
      plus: { amount: '₹1,999', per: '/yr' },
      plusLine: '₹1,999 a year',
      passLine: '₹799 once',
    });
    expect(JSON.stringify(launchPriceDisplay('inr'))).not.toContain('$');
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
    ).toBe('640 emails left to clear \u00b7 resets Nov 9');
    expect(meterPreviewText(2708, 100)).toBe(
      'This clears 2,708 emails. You have 100 free left this month.',
    );
    expect(meterPreviewText(1, 0)).toBe(
      'This clears 1 email, but you have no free emails left this month.',
    );
    expect(meterPreviewText(1, 100)).toBe('This clears 1 email. You have 100 free this month.');
  });

  it('uses the singular quota sentence when one email is requested', () => {
    expect(
      quotaExceededMessage({
        used: 1000,
        limit: 1000,
        resetAt: '2026-11-09T00:00:00.000Z',
        requested: 1,
      }),
    ).toBe('This needs 1 free email, but none of your 1,000 are left this month. More on Nov 9.');
  });

  it('keeps the plural quota sentence when more than one email is requested', () => {
    expect(
      quotaExceededMessage({
        used: 900,
        limit: 1000,
        resetAt: '2026-11-09T00:00:00.000Z',
        requested: 101,
      }),
    ).toBe('This needs 101 free emails, but 100 of 1,000 are left this month. More on Nov 9.');
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

  it('snapshots listed JSON-LD and markdown', () => {
    // Real price ids are listed (founder decision 2026-11-17); INR only while
    // rupee checkout is open (ADR-0045). The Pass is always purchasable now.
    const currencies = () =>
      buildOffersJsonLd().map((offer) => (offer as { priceCurrency: string }).priceCurrency);
    vi.stubEnv('PADDLE_ENV', 'production');
    vi.stubEnv('PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID', '');
    vi.stubEnv('PADDLE_LIVE_INDIA_PASS_PRICE_ID', '');
    expect(currencies()).toEqual(['USD', 'USD', 'USD']);
    vi.stubEnv('PADDLE_LIVE_INDIA_PLUS_ANNUAL_PRICE_ID', 'pri_live_india_plus');
    vi.stubEnv('PADDLE_LIVE_INDIA_PASS_PRICE_ID', 'pri_live_india_pass');
    expect(buildOffersJsonLd()).toEqual(buildOffersJsonLd({ plus: true, pass: true }));
    expect(buildOffersJsonLd().slice(0, 1)).toEqual([
      {
        '@type': 'Offer',
        name: 'Free',
        price: '0',
        priceCurrency: 'USD',
        url: 'https://declutrmail.com/pricing',
      },
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
    const markdown = renderPricingMarkdown();
    expect(markdown).toContain('1,000 emails cleared a month');
    expect(markdown).toContain('Backlog Pass');
    expect(WS1_COPY['pricing.pass.features']).toEqual([
      'No monthly limit for {passDays} days',
      'For one {CONNECTION_TERM}',
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
      '- For one Gmail account',
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
    expect(markdown).toContain('$59 a year');
    expect(markdown).toContain('$19 once');
    expect(markdown).not.toContain('$9/mo');
  });

  it('derives the India answer and the dunning window', () => {
    expect(indiaFaqAnswer()).toContain('Backlog Pass');
    for (const locale of ['usd', 'inr'] as const) {
      expect(indiaFaqAnswer(locale)).not.toContain('You can pay with UPI');
    }
    expect(termsPastDue()).toContain(`${POLICY.dunningDays} days`);
  });

  it('uses the paused India answer only while new INR purchases are paused', () => {
    const paused = indiaFaqAnswer('inr', true);
    const open = indiaFaqAnswer('inr', false);
    expect(paused).toBe(fillStory(WS1_COPY['pricing.faq.india.a.paused'], 'inr'));
    expect(open).toBe(fillStory(WS1_COPY['pricing.faq.india.a'], 'inr'));
    expect(paused).toContain('Buying in rupees is paused for now');
    expect(paused).not.toContain('You can pay with UPI');
    expect(open).not.toContain('You can pay with UPI');
    expect(open).not.toContain('paused for now');
    expect(indiaFaqAnswer()).toBe(indiaFaqAnswer('inr', !indiaPaddlePricesConfigured()));
    expect(INR_CHECKOUT_PAUSED_MESSAGE).toBe(WS1_COPY['pricing.inrPaused.checkout']);
  });

  it('fills the r37 Pass second-account lines from live pricing, never literals', () => {
    expect(passSecondAccountTitle()).toBe('The Backlog Pass covers one Gmail account');
    expect(passSecondAccountTitle()).toBe(fillStory(WS1_COPY['cap.pass.secondAccount.title']));
    expect(passSecondAccountMessage()).toBe(
      `To connect another Gmail account, get ${planName('plus')}. It covers up to ${INBOXES.plus} Gmail accounts for ${plusAmount('usd')} a year.`,
    );
    expect(passSecondAccountMessage('inr')).toBe(
      `To connect another Gmail account, get ${planName('plus')}. It covers up to ${INBOXES.plus} Gmail accounts for ${plusAmount('inr')} a year.`,
    );
    expect(passSecondAccountCta()).toBe(`Get ${planName('plus')}`);
    expect(WS1_COPY['cap.pass.secondAccount.dismiss']).toBe('Not now');
  });
});
