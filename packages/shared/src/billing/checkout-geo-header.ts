/**
 * Request header carrying the server-signed checkout country.
 * Must stay in API `CORS_ALLOWED_HEADERS` — a custom header triggers
 * preflight, and a missing allowlist name fails `fetch` as TypeError
 * (DECLUTRMAIL-WEB-2V).
 */
export const CHECKOUT_GEO_HEADER = 'x-declutr-checkout-geo';
