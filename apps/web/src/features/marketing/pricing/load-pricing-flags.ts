import { isBillingPassEnabled, isPricingV2 } from '@declutrmail/shared/entitlements';

export interface PricingFlags {
  pricingV2: boolean;
  passEnabled: boolean;
  /** API says both India price ids exist. The page still requires the geo secret. */
  indiaCheckoutOpen: boolean;
}

/** Rupee checkout is offered only when the API has India price ids and this server can sign geo. */
export function indiaCheckoutReady(flag: boolean | undefined, secret: string | undefined): boolean {
  return flag === true && typeof secret === 'string' && secret.trim().length > 0;
}

/**
 * Prefer the API so a web rebuild is not required to flip the flag.
 * A missing or unreachable API falls back to this server's env, which
 * is off unless `PRICING_V2=true`.
 *
 * `revalidate` keeps the caller on ISR. `cache: 'no-store'` opts the
 * route into dynamic rendering, which defers `<head>` metadata.
 */
export async function loadPricingFlags(options?: { revalidate?: number }): Promise<PricingFlags> {
  const fallback: PricingFlags = {
    pricingV2: isPricingV2(),
    passEnabled: isBillingPassEnabled(),
    indiaCheckoutOpen: false,
  };
  const apiBase = process.env.NEXT_PUBLIC_API_URL;
  if (!apiBase) return fallback;
  try {
    const response = await fetch(
      `${apiBase}/api/pricing/public`,
      options?.revalidate === undefined
        ? { cache: 'no-store', signal: AbortSignal.timeout(1500) }
        : { next: { revalidate: options.revalidate } },
    );
    if (!response.ok) return fallback;
    const body: unknown = await response.json();
    const data =
      typeof body === 'object' && body !== null && 'data' in body
        ? (body as { data?: unknown }).data
        : body;
    if (typeof data !== 'object' || data === null) return fallback;
    const record = data as {
      pricingV2?: unknown;
      passEnabled?: unknown;
      indiaCheckoutOpen?: unknown;
    };
    return {
      pricingV2: record.pricingV2 === true,
      passEnabled: record.passEnabled === true,
      indiaCheckoutOpen: record.indiaCheckoutOpen === true,
    };
  } catch {
    return fallback;
  }
}
