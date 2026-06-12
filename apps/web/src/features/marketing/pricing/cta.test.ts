import { beforeEach, describe, expect, it, vi } from 'vitest';

import { navigateToCheckout, oauthStartUrl } from './cta';

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

    await navigateToCheckout(push);

    expect(h.apiGet).toHaveBeenCalledWith('/api/auth/me');
    expect(push).toHaveBeenCalledWith('/billing');
  });

  it('sends an unauthed visitor to the OAuth start URL', async () => {
    h.apiGet.mockRejectedValue(new Error('401'));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const push = vi.fn();

    await navigateToCheckout(push);

    expect(push).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith(oauthStartUrl());
    assign.mockRestore();
  });
});
