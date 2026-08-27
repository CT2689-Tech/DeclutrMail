/**
 * Pricing-page CTA navigation (D17 pricing leg).
 *
 * Marketing pages render with NO AuthProvider (D134 public split), so
 * the page cannot know up front whether a session exists. CTA clicks
 * resolve it lazily:
 *
 *   - Free CTA          → probe `GET /api/auth/me`; authed → `/senders`,
 *                         unauthed → OAuth start.
 *   - Plus/Pro CTA      → same probe; authed → `/billing` with validated
 *                         plan/cycle/promo intent, unauthed → OAuth start
 *                         carrying that local post-login destination.
 *
 * The probe reuses `apiGet`, so an expired-access-but-valid-refresh
 * session silently rotates and still lands on /billing instead of
 * bouncing through Google. On a terminal 401 the shared client already
 * hard-redirects to OAuth start; the explicit assign below covers
 * non-401 failures (API unreachable) so the button never silently does
 * nothing.
 */

import { apiGet } from '@/lib/api/client';
import { billingIntentPath, type BillingIntent } from '@/features/billing/billing-intent';
import { oauthStartUrl } from '@/features/marketing/landing/urls';
import { withSignupRef } from '@/features/marketing/signup-ref';

export { oauthStartUrl };

async function hasSession(): Promise<boolean> {
  try {
    await apiGet('/api/auth/me', { suppressAuthRedirect: true });
    return true;
  } catch {
    return false;
  }
}

export async function navigateToCheckout(
  push: (path: string) => void,
  intent: BillingIntent,
): Promise<void> {
  const destination = billingIntentPath(intent);
  if (await hasSession()) {
    push(destination);
    return;
  }
  // Attached HERE, not inside `oauthStartUrl`: this runs only in a click
  // handler, so there is no server render for the cookie read to disagree
  // with. `SignupRefCapture` covers the anchor CTAs the same way.
  window.location.assign(withSignupRef(oauthStartUrl(destination)));
}

export async function navigateToFreeApp(push: (path: string) => void): Promise<void> {
  if (await hasSession()) {
    push('/senders');
    return;
  }
  window.location.assign(withSignupRef(oauthStartUrl()));
}
