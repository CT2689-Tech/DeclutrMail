/**
 * Launch pricing hides the monthly/annual toggle: only Plus annual is
 * listed. The Pass card follows BILLING_PASS_ENABLED, which the screen
 * passes in as `passEnabled`.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WS1_COPY, WS2_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory } from '@declutrmail/shared/entitlements';

import { installFetchStub, jsonServerError } from '@/test/fetch-stub';
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
  it('says so when joining the Pro waitlist fails', async () => {
    installFetchStub([
      { method: 'POST', path: '/api/v1/waitlist', respond: () => jsonServerError() },
    ]);
    renderPicker({ pricingV2: true, passEnabled: true });
    fireEvent.click(
      screen.getByRole('button', { name: fillStory(WS1_COPY['pricing.proRow.link']) }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(WS2_COPY.pro.error);
  });

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
    expect(screen.queryByTestId('launch-offer-pass')).not.toBeInTheDocument();
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
    expect(screen.getByTestId('launch-offer-pass')).toHaveTextContent(
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
    const plus = screen.getByTestId('launch-offer-plus');
    expect(plus).toHaveTextContent('$59');
    expect(plus).toHaveTextContent('a year');
    expect(plus).not.toHaveTextContent('$9 ');
    expect(screen.getByTestId('launch-offer-plus-terms')).toHaveTextContent('billed yearly');
    // The deep link points at the offer; checkout opens only on its button.
    await waitFor(() => expect(plus).toHaveFocus());
    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
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
    const plus = screen.getByTestId('launch-offer-plus');
    const pass = screen.getByTestId('launch-offer-pass');
    expect(plus).toHaveTextContent('₹1,999');
    expect(plus).not.toHaveTextContent('incl. GST');
    expect(screen.getByTestId('launch-offer-plus-terms')).toHaveTextContent(
      fillStory(WS1_COPY['checkout.inr'], 'inr'),
    );
    expect(pass).toHaveTextContent('₹799');
    expect(pass).toHaveTextContent('once');
    expect(plus.textContent).not.toContain('$');
    expect(pass.textContent).not.toContain('$');
  });

  it('quotes one INR catalog for an India visitor', async () => {
    renderPicker(
      { pricingV2: true, passEnabled: true, country: 'IN', indiaCheckoutOpen: true },
      { plan: 'plus', cycle: 'annual', offer: 'pass_onetime' },
    );
    const plus = screen.getByTestId('launch-offer-plus');
    const pass = screen.getByTestId('launch-offer-pass');
    expect(plus).toHaveTextContent('₹1,999');
    expect(plus).not.toHaveTextContent('incl. GST');
    expect(pass).toHaveTextContent('₹799');
    expect(pass).toHaveTextContent(fillStory(WS1_COPY['pricing.pass.renewal'], 'inr'));
    // The Pass deep link points at the Pass card without opening checkout.
    await waitFor(() => expect(pass).toHaveFocus());
    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
    expect(plus.textContent).not.toContain('$');
    expect(pass.textContent).not.toContain('$');
  });

  describe('launch code on the offer cards', () => {
    afterEach(() => vi.useRealTimers());

    it('names the code on each card while the promo runs', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
      renderPicker({ pricingV2: true, passEnabled: true });
      const plus = screen.getByTestId('launch-offer-plus-terms');
      const pass = screen.getByTestId('launch-offer-pass-terms');
      expect(plus).toHaveTextContent('PH30');
      expect(plus).toHaveTextContent('30%');
      expect(plus).not.toHaveTextContent(fillStory(WS1_COPY['pricing.pass.name']));
      expect(pass).toHaveTextContent('PH30');
      expect(pass).toHaveTextContent(fillStory(WS1_COPY['pricing.pass.name']));
      expect(screen.queryByText(WS1_COPY['checkout.codeNote'])).not.toBeInTheDocument();
    });

    it('drops the code line once the promo ends', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
      renderPicker({ pricingV2: true, passEnabled: true });
      expect(screen.getByTestId('launch-offer-plus-terms')).not.toHaveTextContent('PH30');
      expect(screen.getByTestId('launch-offer-pass-terms')).not.toHaveTextContent('PH30');
    });
  });
});
