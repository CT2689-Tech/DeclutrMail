import { indiaCheckoutReady } from './load-pricing-flags';

/** INR only when this visitor can actually check out in rupees. */
export function visitorPricingLocale(input: {
  country: string | null;
  indiaCheckoutOpen: boolean;
  geoSecret: string | undefined;
}): 'inr' | 'usd' {
  return visitorPriceLocale({
    country: input.country,
    indiaCheckoutOpen: indiaCheckoutReady(input.indiaCheckoutOpen, input.geoSecret),
  });
}

/**
 * Display locale after India checkout has already been resolved
 * (secret applied, or the billing page already ANDed country + ready).
 */
export function visitorPriceLocale(input: {
  country?: string | null;
  indiaCheckoutOpen?: boolean;
}): 'usd' | 'inr' {
  return input.country === 'IN' && input.indiaCheckoutOpen === true ? 'inr' : 'usd';
}
