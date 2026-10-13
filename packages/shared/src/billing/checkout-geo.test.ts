import { describe, expect, it } from 'vitest';

import { CHECKOUT_GEO_TTL_MS, signCheckoutGeo, verifyCheckoutGeo } from './checkout-geo';

const SECRET = 'checkout-geo-test-secret';
const ISSUED_AT = 1_700_000_000_000;

describe('checkout geo token', () => {
  it('round-trips a signed country and rejects a swapped country', () => {
    const token = signCheckoutGeo('IN', SECRET);
    expect(verifyCheckoutGeo(token, SECRET)).toBe('IN');
    expect(token).not.toBeNull();
    const forged = token!.replace('IN', 'US');
    expect(verifyCheckoutGeo(forged, SECRET)).toBeNull();
    expect(verifyCheckoutGeo('IN', SECRET)).toBeNull();
    expect(verifyCheckoutGeo(token, 'other-secret')).toBeNull();
    expect(signCheckoutGeo('in', SECRET)).toBeNull();
    expect(signCheckoutGeo('IN', '')).toBeNull();
    expect(verifyCheckoutGeo(null, SECRET)).toBeNull();
  });

  it('accepts a token for one hour and rejects it afterwards', () => {
    const token = signCheckoutGeo('IN', SECRET, ISSUED_AT);
    expect(verifyCheckoutGeo(token, SECRET, ISSUED_AT)).toBe('IN');
    expect(verifyCheckoutGeo(token, SECRET, ISSUED_AT + CHECKOUT_GEO_TTL_MS)).toBe('IN');
    expect(verifyCheckoutGeo(token, SECRET, ISSUED_AT + CHECKOUT_GEO_TTL_MS + 1)).toBeNull();
    expect(verifyCheckoutGeo(token, SECRET, ISSUED_AT - 1)).toBeNull();
  });

  it('rejects a token whose issued-at was rewritten', () => {
    const token = signCheckoutGeo('IN', SECRET, ISSUED_AT);
    expect(token).not.toBeNull();
    const parts = token!.split('.');
    parts[2] = String(ISSUED_AT + 1);
    expect(verifyCheckoutGeo(parts.join('.'), SECRET, ISSUED_AT + 1)).toBeNull();
    expect(verifyCheckoutGeo('v1.IN.signed', SECRET, ISSUED_AT)).toBeNull();
  });
});
