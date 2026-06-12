/**
 * Pricing-page CTA navigation (D17 pricing leg).
 *
 * Marketing pages render with NO AuthProvider (D134 public split), so
 * the page cannot know up front whether a session exists. CTA clicks
 * resolve it lazily:
 *
 *   - Free CTA          → always the OAuth start URL (signup IS login).
 *   - Plus/Pro CTA      → probe `GET /api/auth/me`; authed → `/billing`
 *                         (placeholder route until the U13 billing
 *                         screen lands), unauthed → OAuth start.
 *
 * The probe reuses `apiGet`, so an expired-access-but-valid-refresh
 * session silently rotates and still lands on /billing instead of
 * bouncing through Google. On a terminal 401 the shared client already
 * hard-redirects to OAuth start; the explicit assign below covers
 * non-401 failures (API unreachable) so the button never silently does
 * nothing.
 */

import { apiGet } from '@/lib/api/client';

export function oauthStartUrl(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
  return `${apiBase}/api/auth/google/start`;
}

export async function navigateToCheckout(push: (path: string) => void): Promise<void> {
  try {
    await apiGet('/api/auth/me');
    push('/billing');
  } catch {
    // Unauthed (the client may have already started this navigation on
    // a terminal 401 — re-assigning the same URL is a no-op) or API
    // unreachable: either way OAuth start is the honest destination.
    window.location.assign(oauthStartUrl());
  }
}
