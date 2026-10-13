import { headers } from 'next/headers';

import { trustedVisitorCountry } from '@/features/billing/trusted-visitor-country';
import { loadPricingFlags } from '@/features/marketing/pricing/load-pricing-flags';
import { visitorPricingLocale } from '@/features/marketing/pricing/visitor-pricing-locale';

/**
 * Homepage teaser locale. `/` stays static; the island fetches this
 * after paint. Country comes from the Vercel header only.
 */
export async function GET(): Promise<Response> {
  const [headerList, flags] = await Promise.all([headers(), loadPricingFlags()]);
  const locale = visitorPricingLocale({
    country: trustedVisitorCountry(headerList),
    indiaCheckoutOpen: flags.indiaCheckoutOpen,
    geoSecret: process.env.BILLING_GEO_HMAC_SECRET,
  });
  return Response.json({ locale }, { headers: { 'Cache-Control': 'private, no-store' } });
}
