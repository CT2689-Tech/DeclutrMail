import type { ComponentProps } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { PlanPicker } from './plan-picker';

type Subscription = NonNullable<BillingSubscription['subscription']>;
const PRO_MONTHLY: Subscription = {
  provider: 'paddle',
  tier: 'pro',
  cycle: 'monthly',
  status: 'active',
  currentPeriodEnd: '2026-12-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  cancelSource: null,
  pauseUntil: null,
  foundingMember: false,
  scheduledChange: null,
};

function picker(props: Partial<ComponentProps<typeof PlanPicker>>) {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <PlanPicker
        currentTier="pro"
        grantingSub={null}
        disabled={false}
        pricingV2
        onRequestCancel={() => undefined}
        onPaymentCompleted={() => undefined}
        onCheckoutAttempt={() => Promise.resolve('attempt')}
        onCheckoutAbandoned={() => undefined}
        onCheckoutClosed={() => undefined}
        onPlanChangeAccepted={() => undefined}
        onPlanChangeUnconfirmed={() => undefined}
        onPlanChangeAttempt={() => Promise.resolve('attempt')}
        onPlanChangeFailedKnown={() => undefined}
        {...props}
      />
    </QueryWrapper>,
  );
}

describe('PlanPicker current access and purchase offers', () => {
  it('names complimentary Pro without a recurring catalog price and previews a separate Plus purchase', async () => {
    picker({ currentAccess: { kind: 'tier', priceLabel: 'Complimentary', subscription: null } });
    const current = screen.getByTestId('plan-option-pro');
    expect(current).toHaveTextContent('Current access');
    expect(current).toHaveTextContent('Complimentary');
    expect(current.textContent).not.toMatch(/\$|\/yr|\/mo/);
    expect(screen.queryByRole('button', { name: /Upgrade to Plus/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buy Plus separately' }));
    const preview = await screen.findByTestId('checkout-panel');
    expect(preview).toHaveTextContent('$59');
    expect(preview).toHaveTextContent('billed yearly');
  });

  it('keeps included access distinct from complimentary access', () => {
    picker({
      currentAccess: { kind: 'tier', priceLabel: 'Included with your account', subscription: null },
    });
    const current = screen.getByTestId('plan-option-pro');
    expect(current).toHaveTextContent('Included with your account');
    expect(current).not.toHaveTextContent('Complimentary');
    expect(current.textContent).not.toMatch(/\$|\/yr|\/mo/);
  });

  it('does not badge a Plus subscription offer as the current Backlog Pass', () => {
    picker({
      currentTier: 'plus',
      currentAccess: { kind: 'pass', priceLabel: '$19 once', subscription: null },
    });
    const plus = screen.getByTestId('plan-option-plus');
    expect(plus).toHaveTextContent('$59/yr');
    expect(plus).not.toHaveTextContent('Current plan');
    expect(plus).not.toHaveTextContent('Current access');
    expect(plus).not.toHaveAttribute('aria-current');
    expect(within(plus).getByRole('button', { name: 'Buy Plus separately' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join the Pro waitlist' })).toBeInTheDocument();
  });

  it('shows an existing launch-era Pro monthly subscription on its actual cycle', () => {
    picker({
      grantingSub: PRO_MONTHLY,
      currentAccess: { kind: 'tier', priceLabel: '$19/mo', subscription: PRO_MONTHLY },
    });
    const pro = screen.getByTestId('plan-option-pro');
    expect(pro).toHaveTextContent('Current plan');
    expect(pro).toHaveTextContent('$19/mo');
    expect(pro).not.toHaveTextContent('$190/yr');
  });

  it('keeps a legacy annual switch quote separate from the current monthly charge', () => {
    picker({
      pricingV2: false,
      grantingSub: PRO_MONTHLY,
      currentAccess: { kind: 'tier', priceLabel: '$19/mo', subscription: PRO_MONTHLY },
    });
    const pro = screen.getByTestId('plan-option-pro');
    expect(pro).toHaveTextContent('$190/yr');
    expect(pro).not.toHaveTextContent('Current plan');
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    expect(pro).toHaveTextContent('$19/mo');
    expect(pro).toHaveTextContent('Current plan');
  });

  it('keeps a founding subscriber’s actual annual price', () => {
    const sub: Subscription = { ...PRO_MONTHLY, cycle: 'annual', foundingMember: true };
    picker({ grantingSub: sub });
    const pro = screen.getByTestId('plan-option-pro');
    expect(pro).toHaveTextContent('$129/yr');
    expect(pro).not.toHaveTextContent('$190/yr');
  });

  it('keeps a legacy Plus charge instead of substituting today’s purchase offer', () => {
    const sub: Subscription = {
      ...PRO_MONTHLY,
      tier: 'plus',
      cycle: 'annual',
      providerPriceId: 'pri_legacy_plus',
      chargedUsdCents: 9000,
    };
    picker({ currentTier: 'plus', grantingSub: sub });
    const plus = screen.getByTestId('plan-option-plus');
    expect(plus).toHaveTextContent('$90/yr');
    expect(plus).not.toHaveTextContent('$59/yr');
  });

  it('reads an existing Razorpay charge in its own currency', () => {
    picker({ grantingSub: { ...PRO_MONTHLY, cycle: 'annual', provider: 'razorpay' } });
    const pro = screen.getByTestId('plan-option-pro');
    expect(pro.textContent).toContain('₹');
    expect(pro.textContent).not.toContain('$');
  });

  it('keeps a cancel-scheduled subscription’s display identity while purchases remain locked', () => {
    const sub: Subscription = { ...PRO_MONTHLY, cancelAtPeriodEnd: true };
    picker({
      disabled: true,
      currentAccess: { kind: 'tier', priceLabel: '$19/mo', subscription: sub },
    });
    const pro = screen.getByTestId('plan-option-pro');
    expect(pro).toHaveTextContent('Current plan');
    expect(pro).toHaveTextContent('$19/mo');
    expect(pro).not.toHaveTextContent('Complimentary');
    expect(screen.queryByRole('button', { name: 'Buy Plus separately' })).not.toBeInTheDocument();
  });
});
