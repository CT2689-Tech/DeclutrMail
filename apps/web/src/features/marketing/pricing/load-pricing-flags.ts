import { isBillingPassEnabled, isPricingV2 } from '@declutrmail/shared/entitlements';

export interface PricingFlags {
  pricingV2: boolean;
  passEnabled: boolean;
}

/**
 * Prefer the API so a web rebuild is not required to flip the flag.
 * A missing or unreachable API falls back to this server's env, which
 * is off unless `PRICING_V2=true`.
 */
export async function loadPricingFlags(): Promise<PricingFlags> {
  const fallback: PricingFlags = {
    pricingV2: isPricingV2(),
    passEnabled: isBillingPassEnabled(),
  };
  const apiBase = process.env.NEXT_PUBLIC_API_URL;
  if (!apiBase) return fallback;
  try {
    const response = await fetch(`${apiBase}/api/pricing/public`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return fallback;
    const body: unknown = await response.json();
    const data =
      typeof body === 'object' && body !== null && 'data' in body
        ? (body as { data?: unknown }).data
        : body;
    if (typeof data !== 'object' || data === null) return fallback;
    const record = data as { pricingV2?: unknown; passEnabled?: unknown };
    return {
      pricingV2: record.pricingV2 === true,
      passEnabled: record.passEnabled === true,
    };
  } catch {
    return fallback;
  }
}
