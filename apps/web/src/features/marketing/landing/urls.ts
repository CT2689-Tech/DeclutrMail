/**
 * URL helpers for the public marketing surface (D134).
 *
 * Kept dependency-free (no api client import) — marketing pages must
 * not pull the authed fetch stack into their bundle.
 */

import { withSignupRef } from '@/features/marketing/signup-ref';

/** Canonical site origin for metadata / sitemap / OG URLs. */
export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://declutrmail.com';
}

/**
 * The OAuth entry point (`GET /api/auth/google/start` on the API,
 * see apps/api/src/auth/google-oauth.controller.ts). Used verbatim as
 * the primary CTA href — no client JS needed to start the flow.
 * First-touch `ref` is appended when the capture cookie is already set
 * (SSR first paint may miss it; SignupRefCapture stamps it on click).
 */
export function oauthStartUrl(returnTo?: string): string {
  // Trailing slash stripped for the same reason connect-mailbox-url.ts does
  // it: a pasted `https://api.example.com/` would otherwise produce a doubled
  // `//api/auth/google/start`, which Nest does not route.
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  const path = `${apiBase}/api/auth/google/start`;
  const params = new URLSearchParams();
  if (returnTo) params.set('returnTo', returnTo);
  const qs = params.toString();
  return withSignupRef(qs ? `${path}?${qs}` : path);
}
