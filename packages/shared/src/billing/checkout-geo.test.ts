import { describe, expect, it } from 'vitest';

import { signCheckoutGeo, verifyCheckoutGeo } from './checkout-geo';

const SECRET = 'checkout-geo-test-secret';

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
});
