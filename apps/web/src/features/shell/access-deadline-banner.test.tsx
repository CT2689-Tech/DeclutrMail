import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { billingKeys } from '@/features/billing/api/query-keys';

const useTier = vi.fn();
const useBillingSubscription = vi.fn();
const mutate = vi.fn();
const pathname = { current: '/senders' };

vi.mock('@/features/auth/api/use-tier', () => ({
  useTier: () => useTier(),
}));
vi.mock('@/features/billing/api/use-billing-subscription', () => ({
  useBillingSubscription: () => useBillingSubscription(),
}));
vi.mock('@/features/billing/api/use-payment-method', () => ({
  usePaymentMethodSession: () => ({ mutate, isPending: false }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
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
  pathname.current = '/senders';
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

  it('reads the billing page cache without starting another subscription read', async () => {
    pathname.current = '/billing';
    const client = new QueryClient();
    client.setQueryData(billingKeys.subscription(), billing('past_due').data);
    render(
      <QueryClientProvider client={client}>
        <AccessDeadlineBanner />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('access-deadline-banner')).toHaveTextContent(
      'November 3, 2026',
    );
    expect(useBillingSubscription).not.toHaveBeenCalled();
    client.clear();
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
