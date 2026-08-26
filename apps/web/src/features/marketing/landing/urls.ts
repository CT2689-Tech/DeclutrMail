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
 *
 * DELIBERATELY FREE OF THE FIRST-TOUCH `ref`, and it must stay that way.
 * This is rendered into SSR markup; reading the capture cookie here makes
 * the server emit a bare href while hydration emits `?ref=…` on the very
 * first visit that sets the cookie (the middleware sets it on the same
 * response that renders the page), which is a hydration mismatch on the
 * primary CTA of the busiest public routes. The `ref` is attached where
 * there is no server render to disagree with: `SignupRefCapture` stamps
 * anchors on click, and imperative navigations wrap this in
 * `withSignupRef` themselves. The API prefers the shared
 * `.declutrmail.com` cookie over the query param regardless.
 */
export function oauthStartUrl(returnTo?: string): string {
  // Trailing slash stripped for the same reason connect-mailbox-url.ts does
  // it: a pasted `https://api.example.com/` would otherwise produce a doubled
  // `//api/auth/google/start`, which Nest does not route.
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  const path = `${apiBase}/api/auth/google/start`;
  if (!returnTo) return path;
  return `${path}?${new URLSearchParams({ returnTo }).toString()}`;
}
