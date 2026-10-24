/**
 * Launch pricing hides the monthly/annual toggle: only Plus annual is
 * listed. The Pass card follows BILLING_PASS_ENABLED, which the screen
 * passes in as `passEnabled`.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory } from '@declutrmail/shared/entitlements';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { PlanPicker } from './plan-picker';
import type { BillingIntent } from './billing-intent';

function renderPicker(
  flags: {
    pricingV2: boolean;
    passEnabled: boolean;
    country?: string;
    indiaCheckoutOpen?: boolean;
  },
  initialIntent: BillingIntent | null = null,
) {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <PlanPicker
        currentTier="free"
        grantingSub={null}
        disabled={false}
        initialIntent={initialIntent}
        pricingV2={flags.pricingV2}
        passEnabled={flags.passEnabled}
        country={flags.country ?? null}
        indiaCheckoutOpen={flags.indiaCheckoutOpen ?? false}
        onRequestCancel={() => undefined}
        onPaymentCompleted={() => undefined}
        onCheckoutAttempt={() => Promise.resolve('attempt')}
        onCheckoutAbandoned={() => undefined}
        onCheckoutClosed={() => undefined}
        onPlanChangeAccepted={() => undefined}
        onPlanChangeUnconfirmed={() => undefined}
        onPlanChangeAttempt={() => Promise.resolve('attempt')}
        onPlanChangeFailedKnown={() => undefined}
      />
    </QueryWrapper>,
  );
}

describe('PlanPicker launch pricing', () => {
  it('hides the cycle toggle when only one cycle is listed', () => {
    renderPicker({ pricingV2: true, passEnabled: false });
    expect(screen.queryByRole('button', { name: 'Monthly' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Billing interval' })).not.toBeInTheDocument();
  });

  it('keeps the cycle toggle while launch pricing is off', () => {
    renderPicker({ pricingV2: false, passEnabled: false });
    expect(screen.getByRole('button', { name: 'Monthly' })).toBeInTheDocument();
  });

  it('hides the Pass until the server says it is enabled', () => {
    const { rerender } = renderPicker({ pricingV2: true, passEnabled: false });
    expect(screen.queryByTestId('pass-offer-card')).not.toBeInTheDocument();
    rerender(
      <QueryWrapper client={createTestQueryClient()}>
        <PlanPicker
          currentTier="free"
          grantingSub={null}
          disabled={false}
          pricingV2
          passEnabled
          onRequestCancel={() => undefined}
          onPaymentCompleted={() => undefined}
          onCheckoutAttempt={() => Promise.resolve('attempt')}
          onCheckoutAbandoned={() => undefined}
          onCheckoutClosed={() => undefined}
          onPlanChangeAccepted={() => undefined}
          onPlanChangeUnconfirmed={() => undefined}
          onPlanChangeAttempt={() => Promise.resolve('attempt')}
          onPlanChangeFailedKnown={() => undefined}
        />
      </QueryWrapper>,
    );
    expect(screen.getByTestId('pass-offer-card')).toHaveTextContent(
      fillStory(WS1_COPY['pricing.pass.name']),
    );
  });

  it('does not open Pro checkout from a deep link while launch pricing is on', () => {
    renderPicker({ pricingV2: true, passEnabled: false }, { plan: 'pro', cycle: 'monthly' });
    expect(screen.queryByText('Loading checkout preview…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join the Pro waitlist' })).toBeInTheDocument();
  });

  it('ignores a monthly Plus deep link and quotes annual', async () => {
    renderPicker({ pricingV2: true, passEnabled: false }, { plan: 'plus', cycle: 'monthly' });
    expect(screen.queryByRole('button', { name: 'Monthly' })).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-option-plus')).toHaveTextContent('$59/yr');
    expect(screen.getByTestId('plan-option-plus')).not.toHaveTextContent('$9');
    const panel = await screen.findByTestId('checkout-panel');
    expect(panel).toHaveTextContent('billed yearly');
    expect(panel).not.toHaveTextContent('$9');
  });

  it('opens Plus Before you pay for a Pass-only /billing?plan=plus deep link', async () => {
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <PlanPicker
          currentTier="plus"
          grantingSub={null}
          disabled={false}
          initialIntent={{ plan: 'plus', cycle: 'annual' }}
          pricingV2
          passEnabled
          onRequestCancel={() => undefined}
          onPaymentCompleted={() => undefined}
          onCheckoutAttempt={() => Promise.resolve('attempt')}
          onCheckoutAbandoned={() => undefined}
          onCheckoutClosed={() => undefined}
          onPlanChangeAccepted={() => undefined}
          onPlanChangeUnconfirmed={() => undefined}
          onPlanChangeAttempt={() => Promise.resolve('attempt')}
          onPlanChangeFailedKnown={() => undefined}
        />
      </QueryWrapper>,
    );

    expect(screen.getByRole('button', { name: 'Buy Plus separately' })).toBeInTheDocument();
    const panel = await screen.findByTestId('checkout-panel');
    expect(panel).toHaveTextContent(fillStory(WS1_COPY['checkout.title']));
    expect(panel).toHaveTextContent(fillStory(WS1_COPY['checkout.plus.summary']));
    expect(panel).not.toHaveTextContent(fillStory(WS1_COPY['checkout.pass.summary']));
    expect(
      screen.getByRole('button', { name: fillStory(WS1_COPY['checkout.continue']) }),
    ).toBeInTheDocument();
  });

  it('quotes one INR catalog on plain /billing with no offer params', () => {
    renderPicker({ pricingV2: true, passEnabled: true, country: 'IN', indiaCheckoutOpen: true });
    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-option-free')).toHaveTextContent('₹0');
    expect(screen.getByTestId('plan-option-plus')).toHaveTextContent('₹1,999/yr');
    expect(screen.getByTestId('plan-option-plus')).not.toHaveTextContent('incl. GST');
    expect(screen.getByTestId('pass-offer-card')).toHaveTextContent(
      '₹799 once · 30 days, one Gmail account · doesn’t renew',
    );
    expect(screen.getByTestId('plan-option-free').textContent).not.toContain('$');
    expect(screen.getByTestId('plan-option-plus').textContent).not.toContain('$');
    expect(screen.getByTestId('pass-offer-card').textContent).not.toContain('$');
  });

  it('quotes one INR catalog for an India visitor', async () => {
    renderPicker(
      { pricingV2: true, passEnabled: true, country: 'IN', indiaCheckoutOpen: true },
      { plan: 'plus', cycle: 'annual', offer: 'pass_onetime' },
    );
    expect(screen.getByTestId('plan-option-free')).toHaveTextContent('₹0');
    expect(screen.getByTestId('plan-option-plus')).toHaveTextContent('₹1,999/yr');
    expect(screen.getByTestId('plan-option-plus')).not.toHaveTextContent('incl. GST');
    expect(screen.getByTestId('pass-offer-card')).toHaveTextContent(
      '₹799 once · 30 days, one Gmail account · doesn’t renew',
    );
    const panel = await screen.findByTestId('checkout-panel');
    expect(panel).toHaveTextContent('₹799 once, today');
    expect(screen.getByTestId('plan-option-free').textContent).not.toContain('$');
    expect(screen.getByTestId('plan-option-plus').textContent).not.toContain('$');
    expect(screen.getByTestId('pass-offer-card').textContent).not.toContain('$');
    expect(panel.textContent).not.toContain('$');
  });
});
