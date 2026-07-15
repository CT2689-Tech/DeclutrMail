import { beforeEach, describe, expect, it, vi } from 'vitest';

import { navigateToCheckout, navigateToFreeApp, oauthStartUrl } from './cta';

/**
 * Pricing CTA navigation tests (D17 pricing leg).
 *
 * authed → /billing; unauthed/unreachable → OAuth start. The probe
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
  it('routes an authed visitor to /billing', async () => {
    h.apiGet.mockResolvedValue({ data: { id: 'u1' } });
    const push = vi.fn();

    await navigateToCheckout(push, { plan: 'pro', cycle: 'annual', promo: 'foundingPro' });

    expect(h.apiGet).toHaveBeenCalledWith('/api/auth/me', { suppressAuthRedirect: true });
    expect(push).toHaveBeenCalledWith('/billing?plan=pro&cycle=annual&promo=foundingPro');
  });

  it('sends an unauthed visitor to the OAuth start URL', async () => {
    h.apiGet.mockRejectedValue(new Error('401'));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const push = vi.fn();

    await navigateToCheckout(push, { plan: 'plus', cycle: 'monthly' });

    expect(push).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith(oauthStartUrl('/billing?plan=plus&cycle=monthly'));
    assign.mockRestore();
  });

  it('routes an authenticated Free visitor into the app instead of reconnecting Gmail', async () => {
    h.apiGet.mockResolvedValue({ data: { id: 'u1' } });
    const push = vi.fn();

    await navigateToFreeApp(push);

    expect(push).toHaveBeenCalledWith('/senders');
  });

  it('starts OAuth for a signed-out Free visitor', async () => {
    h.apiGet.mockRejectedValue(new Error('401'));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);

    await navigateToFreeApp(vi.fn());

    expect(assign).toHaveBeenCalledWith(oauthStartUrl());
    assign.mockRestore();
  });
});
