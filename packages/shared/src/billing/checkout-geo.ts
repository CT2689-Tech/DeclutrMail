import { createHmac, timingSafeEqual } from 'node:crypto';

import { CHECKOUT_GEO_HEADER } from './checkout-geo-header';

export { CHECKOUT_GEO_HEADER };

const TOKEN_PREFIX = 'v1';
const SIGNED_PAYLOAD = 'checkout-geo:v1:';

/** A copied token stops working an hour after the server minted it. */
export const CHECKOUT_GEO_TTL_MS = 60 * 60 * 1000;

function mac(country: string, issuedAtMs: number, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${SIGNED_PAYLOAD}${country}:${issuedAtMs}`).digest();
}

/**
 * Sign a two-letter country for checkout. Returns null when the secret
 * or the country is missing. The browser cannot mint this token.
 * `issuedAtMs` is inside the MAC, so rewriting the timestamp fails closed.
 */
export function signCheckoutGeo(
  country: string | null | undefined,
  secret: string | undefined,
  issuedAtMs: number = Date.now(),
): string | null {
  if (!secret || !country || !/^[A-Z]{2}$/.test(country)) return null;
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0) return null;
  const signature = mac(country, issuedAtMs, secret).toString('base64url');
  return `${TOKEN_PREFIX}.${country}.${issuedAtMs}.${signature}`;
}

/**
 * Verified country, or null when the token is missing, unsigned,
 * expired, or altered. A failed check is USD, never India.
 * Valid from the issued-at instant through one hour later.
 */
export function verifyCheckoutGeo(
  token: string | null | undefined,
  secret: string | undefined,
  now: number = Date.now(),
): string | null {
  if (!secret || !token || !Number.isSafeInteger(now)) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return null;
  const country = parts[1];
  const issuedRaw = parts[2];
  const givenMac = parts[3];
  if (!country || !/^[A-Z]{2}$/.test(country) || !issuedRaw || !givenMac) return null;
  if (!/^\d+$/.test(issuedRaw)) return null;
  const issuedAtMs = Number(issuedRaw);
  if (!Number.isSafeInteger(issuedAtMs)) return null;
  const age = now - issuedAtMs;
  if (age < 0 || age > CHECKOUT_GEO_TTL_MS) return null;
  const expected = mac(country, issuedAtMs, secret);
  const given = Buffer.from(givenMac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return country;
}
