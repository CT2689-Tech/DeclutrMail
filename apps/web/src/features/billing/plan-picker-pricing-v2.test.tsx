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
  flags: { pricingV2: boolean; passEnabled: boolean },
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
});
