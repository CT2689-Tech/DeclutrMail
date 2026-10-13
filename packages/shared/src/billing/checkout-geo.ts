import { createHmac, timingSafeEqual } from 'node:crypto';

import { CHECKOUT_GEO_HEADER } from './checkout-geo-header';

export { CHECKOUT_GEO_HEADER };

const TOKEN_PREFIX = 'v1';
const SIGNED_PAYLOAD = 'checkout-geo:v1:';

function mac(country: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${SIGNED_PAYLOAD}${country}`).digest();
}

/**
 * Sign a two-letter country for checkout. Returns null when the secret
 * or the country is missing. The browser cannot mint this token.
 */
export function signCheckoutGeo(
  country: string | null | undefined,
  secret: string | undefined,
): string | null {
  if (!secret || !country || !/^[A-Z]{2}$/.test(country)) return null;
  return `${TOKEN_PREFIX}.${country}.${mac(country, secret).toString('base64url')}`;
}

/**
 * Verified country, or null when the token is missing, unsigned, or
 * altered. A failed check is USD, never India.
 */
export function verifyCheckoutGeo(
  token: string | null | undefined,
  secret: string | undefined,
): string | null {
  if (!secret || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  const country = parts[1];
  const givenMac = parts[2];
  if (!country || !/^[A-Z]{2}$/.test(country) || !givenMac) return null;
  const expected = mac(country, secret);
  const given = Buffer.from(givenMac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return country;
}
