import { describe, expect, it } from 'vitest';

import { visitorPriceLocale, visitorPricingLocale } from './visitor-pricing-locale';

describe('visitorPriceLocale', () => {
  it('is INR only for an India visitor whose checkout is already open', () => {
    expect(visitorPriceLocale({ country: 'IN', indiaCheckoutOpen: true })).toBe('inr');
    expect(visitorPriceLocale({ country: 'IN', indiaCheckoutOpen: false })).toBe('usd');
    expect(visitorPriceLocale({ country: 'US', indiaCheckoutOpen: true })).toBe('usd');
    expect(visitorPriceLocale({})).toBe('usd');
  });
});

describe('visitorPricingLocale', () => {
  it('quotes INR only when India checkout can actually open', () => {
    expect(
      visitorPricingLocale({ country: 'IN', indiaCheckoutOpen: true, geoSecret: 'secret' }),
    ).toBe('inr');
    expect(
      visitorPricingLocale({ country: 'IN', indiaCheckoutOpen: false, geoSecret: 'secret' }),
    ).toBe('usd');
    expect(visitorPricingLocale({ country: 'IN', indiaCheckoutOpen: true, geoSecret: '' })).toBe(
      'usd',
    );
    expect(
      visitorPricingLocale({ country: 'US', indiaCheckoutOpen: true, geoSecret: 'secret' }),
    ).toBe('usd');
    expect(
      visitorPricingLocale({ country: null, indiaCheckoutOpen: true, geoSecret: 'secret' }),
    ).toBe('usd');
  });
});
