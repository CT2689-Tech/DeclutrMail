import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useTier = vi.fn();
const useBillingSubscription = vi.fn();
const mutate = vi.fn();

vi.mock('@/features/auth/api/use-tier', () => ({
  useTier: () => useTier(),
}));
vi.mock('@/features/billing/api/use-billing-subscription', () => ({
  useBillingSubscription: () => useBillingSubscription(),
}));
vi.mock('@/features/billing/api/use-payment-method', () => ({
  usePaymentMethodSession: () => ({ mutate, isPending: false }),
}));

import { AccessDeadlineBanner } from './access-deadline-banner';

const DEADLINE = '2026-11-03T07:00:00.000Z';

function billing(status: 'active' | 'past_due', extra: Record<string, unknown> = {}) {
  return {
    data: {
      tier: 'plus',
      foundingMember: false,
      subscription: {
        provider: 'paddle',
        tier: 'plus',
        status,
        cycle: 'monthly',
        currentPeriodEnd: DEADLINE,
        entitlementEndsAt: DEADLINE,
        cancelAtPeriodEnd: false,
        cancelSource: null,
        pauseUntil: null,
        foundingMember: false,
        scheduledChange: null,
        ...extra,
      },
      pendingCheckout: null,
      complimentary: null,
    },
  };
}

beforeEach(() => {
  useTier.mockReset();
  useBillingSubscription.mockReset();
  mutate.mockReset();
  sessionStorage.clear();
  useTier.mockReturnValue({ tier: 'plus' });
  useBillingSubscription.mockReturnValue(billing('active'));
});

describe('AccessDeadlineBanner', () => {
  it('shows the server date for a past-due plan and opens the payment-method session', async () => {
    useBillingSubscription.mockReturnValue(billing('past_due'));
    render(<AccessDeadlineBanner />);
    const banner = await screen.findByTestId('access-deadline-banner');
    expect(banner).toHaveTextContent('November 3, 2026');
    expect(banner).toHaveTextContent('Plus');
    fireEvent.click(screen.getByRole('button', { name: WS2_COPY.banners.pastDue.cta }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('hides an active plan and a Free workspace', () => {
    const { rerender } = render(<AccessDeadlineBanner />);
    expect(screen.queryByTestId('access-deadline-banner')).toBeNull();
    useTier.mockReturnValue({ tier: 'free' });
    useBillingSubscription.mockReturnValue(billing('past_due'));
    rerender(<AccessDeadlineBanner />);
    expect(screen.queryByTestId('access-deadline-banner')).toBeNull();
  });

  it('dismisses for this session and returns when that session store is cleared', async () => {
    useBillingSubscription.mockReturnValue(billing('past_due'));
    const first = render(<AccessDeadlineBanner />);
    fireEvent.click(await screen.findByRole('button', { name: WS2_COPY.banners.pastDue.dismiss }));
    await waitFor(() => expect(screen.queryByTestId('access-deadline-banner')).toBeNull());
    first.unmount();
    render(<AccessDeadlineBanner />);
    await waitFor(() => expect(screen.queryByTestId('access-deadline-banner')).toBeNull());
    sessionStorage.clear();
    render(<AccessDeadlineBanner />);
    expect(await screen.findByTestId('access-deadline-banner')).toBeInTheDocument();
  });
});
