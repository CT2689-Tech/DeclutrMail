import { describe, expect, it } from 'vitest';

import { billingIntentPath } from './billing-intent';
import { parseBillingIntentParams, parseBillingIntentPath } from './parse-billing-intent';

describe('billing intent', () => {
  it('round-trips canonical paid plan, cycle, and promo intent', () => {
    const intent = { plan: 'pro', cycle: 'annual', promo: 'foundingPro' } as const;
    const path = billingIntentPath(intent);
    expect(path).toBe('/billing?plan=pro&cycle=annual&promo=foundingPro');
    expect(parseBillingIntentPath(path)).toEqual(intent);
  });

  it.each([
    'https://evil.example/billing?plan=pro&cycle=annual',
    '//evil.example/billing?plan=pro&cycle=annual',
    '/billing?plan=enterprise&cycle=annual',
    '/billing?plan=plus&cycle=weekly',
    '/billing?plan=plus&cycle=annual&promo=foundingPro',
    '/billing?plan=pro&cycle=annual&next=https://evil.example',
    '/billing?plan=pro&plan=plus&cycle=annual',
  ])('rejects an untrusted or impossible intent: %s', (path) => {
    expect(parseBillingIntentPath(path)).toBeNull();
  });

  it('preserves the exact upgrade origin through checkout intent', () => {
    const intent = { plan: 'pro', cycle: 'monthly', from: '/senders?sender=s-123&q=news' } as const;
    expect(parseBillingIntentPath(billingIntentPath(intent))).toEqual(intent);
    expect(
      parseBillingIntentParams({ plan: 'pro', cycle: 'monthly', from: '/billing' }),
    ).toBeNull();
  });

  it('rejects array-valued server query parameters', () => {
    expect(parseBillingIntentParams({ plan: ['pro'], cycle: 'annual' })).toBeNull();
  });

  it('rejects unreviewed server query parameters', () => {
    expect(
      parseBillingIntentParams({ plan: 'pro', cycle: 'annual', next: 'https://evil.example' }),
    ).toBeNull();
  });
});
