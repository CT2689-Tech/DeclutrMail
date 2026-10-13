import { signCheckoutGeo } from '@declutrmail/shared/billing/checkout-geo';

import { trustedVisitorCountry } from './trusted-visitor-country';

/**
 * Country and checkout token for /billing. Never reads
 * `x-declutr-country`: prefetch requests skip middleware, so a
 * client-sent value would otherwise be signed.
 */
export function mintCheckoutGeo(
  headerList: { get(name: string): string | null },
  secret: string | undefined,
): { country: string | null; token: string | null } {
  const country = trustedVisitorCountry(headerList);
  return { country, token: signCheckoutGeo(country, secret) };
}
