import { describe, expect, it } from 'vitest';

import { visitorPricingLocale } from './visitor-pricing-locale';

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
