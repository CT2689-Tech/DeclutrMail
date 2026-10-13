import { indiaCheckoutReady } from './load-pricing-flags';

/** INR only when this visitor can actually check out in rupees. */
export function visitorPricingLocale(input: {
  country: string | null;
  indiaCheckoutOpen: boolean;
  geoSecret: string | undefined;
}): 'inr' | 'usd' {
  return input.country === 'IN' && indiaCheckoutReady(input.indiaCheckoutOpen, input.geoSecret)
    ? 'inr'
    : 'usd';
}
