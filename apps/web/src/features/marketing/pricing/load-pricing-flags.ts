export interface PricingFlags {
  /** API says both India price ids exist. The page still requires the geo secret. */
  indiaCheckoutOpen: boolean;
}

/** Rupee checkout is offered only when the API has India price ids and this server can sign geo. */
export function indiaCheckoutReady(flag: boolean | undefined, secret: string | undefined): boolean {
  return flag === true && typeof secret === 'string' && secret.trim().length > 0;
}

/**
 * Read India checkout availability from the API. A missing or
 * unreachable API keeps rupee checkout closed.
 *
 * `revalidate` keeps the caller on ISR. `cache: 'no-store'` opts the
 * route into dynamic rendering, which defers `<head>` metadata.
 */
export async function loadPricingFlags(options?: { revalidate?: number }): Promise<PricingFlags> {
  const fallback: PricingFlags = { indiaCheckoutOpen: false };
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
    const record = data as { indiaCheckoutOpen?: unknown };
    return { indiaCheckoutOpen: record.indiaCheckoutOpen === true };
  } catch {
    return fallback;
  }
}
