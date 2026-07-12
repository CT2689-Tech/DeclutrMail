import { describe, expect, it } from 'vitest';

import {
  billingIntentPath,
  parseBillingIntentParams,
  parseBillingIntentPath,
} from './billing-intent';

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

  it('rejects array-valued server query parameters', () => {
    expect(parseBillingIntentParams({ plan: ['pro'], cycle: 'annual' })).toBeNull();
  });

  it('rejects unreviewed server query parameters', () => {
    expect(
      parseBillingIntentParams({ plan: 'pro', cycle: 'annual', next: 'https://evil.example' }),
    ).toBeNull();
  });
});
