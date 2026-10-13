import { describe, expect, it } from 'vitest';

import { verifyCheckoutGeo } from '@declutrmail/shared/billing/checkout-geo';

import { mintCheckoutGeo } from './mint-checkout-geo';

const SECRET = 'checkout-geo-test-secret';

describe('mintCheckoutGeo', () => {
  it('ignores a client country on a prefetch and mints no India token', () => {
    const minted = mintCheckoutGeo(
      new Headers({
        'next-router-prefetch': '1',
        purpose: 'prefetch',
        'x-declutr-country': 'IN',
      }),
      SECRET,
    );
    expect(minted.country).toBeNull();
    expect(minted.token).toBeNull();
    expect(verifyCheckoutGeo(minted.token, SECRET)).toBeNull();
  });

  it('trusts x-vercel-ip-country over a forged x-declutr-country', () => {
    const minted = mintCheckoutGeo(
      new Headers({
        'x-vercel-ip-country': 'US',
        'x-declutr-country': 'IN',
      }),
      SECRET,
    );
    expect(minted.country).toBe('US');
    expect(verifyCheckoutGeo(minted.token, SECRET)).toBe('US');
  });
});
