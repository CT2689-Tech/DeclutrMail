/**
 * URL helpers for the public marketing surface (D134).
 *
 * Kept dependency-free (no api client import) — marketing pages must
 * not pull the authed fetch stack into their bundle.
 */

/** Canonical site origin for metadata / sitemap / OG URLs. */
export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://declutrmail.com';
}

/**
 * The OAuth entry point (`GET /api/auth/google/start` on the API,
 * see apps/api/src/auth/google-oauth.controller.ts). Used verbatim as
 * the primary CTA href — no client JS needed to start the flow.
 */
export function oauthStartUrl(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
  return `${apiBase}/api/auth/google/start`;
}
