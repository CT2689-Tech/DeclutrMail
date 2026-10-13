const VERCEL_COUNTRY_HEADER = 'x-vercel-ip-country';

/**
 * Edge country from `x-vercel-ip-country` only. A client-sent
 * `x-declutr-country` is ignored, including on prefetches that skip
 * middleware.
 */
export function trustedVisitorCountry(headerList: {
  get(name: string): string | null;
}): string | null {
  const raw = headerList.get(VERCEL_COUNTRY_HEADER);
  if (!raw) return null;
  const country = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}
