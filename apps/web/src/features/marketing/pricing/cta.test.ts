import { beforeEach, describe, expect, it, vi } from 'vitest';

import { navigateToCheckout, navigateToFreeApp } from './cta';
import { permissionEntryUrl } from '../landing/urls';
import { parseBillingIntentPath } from '@/features/billing/parse-billing-intent';
import { onboardingPathKeepingOAuthResult } from '@/features/onboarding/onboarding-return-to';

/**
 * Pricing CTA navigation tests (D17 pricing leg).
 *
 * authed → /billing; unauthed/unreachable → permissions checkpoint. The probe
 * reuses the shared client so refresh rotation works (covered there).
 */

const h = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  apiGet: h.apiGet,
}));

beforeEach(() => {
  h.apiGet.mockReset();
});

describe('navigateToCheckout', () => {
  it('keeps the signed-out Pass choice through permissions and onboarding to Billing', async () => {
    h.apiGet.mockRejectedValue(new Error('401'));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const push = vi.fn();
    const intent = { plan: 'plus', cycle: 'annual', offer: 'pass_onetime' } as const;
    await navigateToCheckout(push, intent);
    expect(push).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith(
      '/sign-in?returnTo=%2Fbilling%3Fplan%3Dplus%26cycle%3Dannual%26offer%3Dpass_onetime',
    );
    const entry = new URL(assign.mock.calls[0]![0], 'https://app.test');
    const onboarding = new URL(
      onboardingPathKeepingOAuthResult('', entry.searchParams.get('returnTo') ?? undefined),
      'https://app.test',
    );
    expect(parseBillingIntentPath(onboarding.searchParams.get('returnTo'))).toEqual(intent);
    assign.mockRestore();
  });
  it.each([
    '/billing?plan=plus&cycle=annual&offer=unknown',
    '/billing?plan=pro&cycle=annual&offer=pass_onetime',
    '/billing?plan=plus&cycle=monthly&offer=pass_onetime',
    '/billing?plan=plus&cycle=annual&offer=pass_onetime&offer=pass_onetime',
    '/billing?plan=plus&cycle=annual&offer=pass_onetime&next=https://evil.test',
    'https://evil.test/billing?plan=plus&cycle=annual&offer=pass_onetime',
  ])('does not carry an untrusted Pass destination into permissions: %s', (path) => {
    expect(permissionEntryUrl(path)).toBe('/sign-in');
  });
  it('routes an authed visitor to /billing', async () => {
    h.apiGet.mockResolvedValue({ data: { id: 'u1' } });
    const push = vi.fn();

    await navigateToCheckout(push, { plan: 'pro', cycle: 'annual', promo: 'foundingPro' });

    expect(h.apiGet).toHaveBeenCalledWith('/api/auth/me', { suppressAuthRedirect: true });
    expect(push).toHaveBeenCalledWith('/billing?plan=pro&cycle=annual&promo=foundingPro');
  });

  it('sends an unauthed visitor to the permissions entry URL', async () => {
    h.apiGet.mockRejectedValue(new Error('401'));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const push = vi.fn();

    await navigateToCheckout(push, { plan: 'plus', cycle: 'monthly' });

    expect(push).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith(permissionEntryUrl('/billing?plan=plus&cycle=monthly'));
    assign.mockRestore();
  });

  it('routes an authenticated Free visitor into the app instead of reconnecting Gmail', async () => {
    h.apiGet.mockResolvedValue({ data: { id: 'u1' } });
    const push = vi.fn();

    await navigateToFreeApp(push);

    expect(push).toHaveBeenCalledWith('/home');
  });

  it('opens the permissions checkpoint for a signed-out Free visitor', async () => {
    h.apiGet.mockRejectedValue(new Error('401'));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);

    await navigateToFreeApp(vi.fn());

    expect(assign).toHaveBeenCalledWith(permissionEntryUrl());
    assign.mockRestore();
  });
});
