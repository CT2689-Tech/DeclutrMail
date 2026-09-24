/**
 * Pricing-page CTA navigation (D17 pricing leg).
 *
 * Marketing pages render with NO AuthProvider (D134 public split), so
 * the page cannot know up front whether a session exists. CTA clicks
 * resolve it lazily:
 *
 *   - Free CTA          → probe `GET /api/auth/me`; authed → `/senders`,
 *                         unauthed → permissions entry.
 *   - Plus/Pro CTA      → same probe; authed → `/billing` with validated
 *                         plan/cycle/promo intent, unauthed → permissions entry
 *                         carrying that local post-login destination.
 *
 * The probe reuses `apiGet`, so an expired-access-but-valid-refresh
 * session silently rotates and still lands on /billing instead of
 * bouncing through Google. On a terminal 401 the shared client already
 * normally redirects to OAuth, but this probe suppresses that redirect. The explicit assign below covers
 * non-401 failures (API unreachable) so the button never silently does
 * nothing.
 */

import { apiGet } from '@/lib/api/client';
import { billingIntentPath, type BillingIntent } from '@/features/billing/billing-intent';
import { oauthStartUrl, permissionEntryUrl } from '@/features/marketing/landing/urls';
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
  // Attached HERE, not inside `permissionEntryUrl`: this runs only in a click
  // handler, so there is no server render for the cookie read to disagree
  // with. `SignupRefCapture` covers the anchor CTAs the same way.
  window.location.assign(withSignupRef(permissionEntryUrl(destination)));
}

export async function navigateToFreeApp(push: (path: string) => void): Promise<void> {
  if (await hasSession()) {
    push('/senders');
    return;
  }
  window.location.assign(withSignupRef(permissionEntryUrl()));
}
