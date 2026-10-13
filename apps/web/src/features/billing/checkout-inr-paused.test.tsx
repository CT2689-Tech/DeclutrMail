import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PLUS_ANNUAL_2026_10 } from '@declutrmail/shared/entitlements';

import { ConfirmPanel } from './checkout-confirm-panel';

const CHECKOUT =
  'Buying a plan in rupees is paused for now. Email support@declutrmail.com for help.';

function renderPanel(
  provider: 'razorpay' | 'paddle' = 'razorpay',
  options?: { pricingV2?: boolean; country?: string | null; indiaCheckoutOpen?: boolean },
) {
  return render(
    <ConfirmPanel
      target="plus"
      cycle="annual"
      provider={provider}
      razorpayOffered={!options?.pricingV2}
      pricingV2={options?.pricingV2 ?? false}
      country={options?.country ?? null}
      indiaCheckoutOpen={options?.indiaCheckoutOpen ?? false}
      pricePointOverride={options?.pricingV2 ? PLUS_ANNUAL_2026_10 : null}
      onProviderChange={() => undefined}
      foundingEligible={false}
      claimFounding={false}
      onClaimFoundingChange={() => undefined}
      isPending={false}
      errorMessage={null}
      onConfirm={() => undefined}
      onDismiss={() => undefined}
    />,
  );
}

describe('INR pause copy on checkout confirm', () => {
  it('shows the paused checkout line and button while new INR purchases are paused', () => {
    renderPanel('razorpay');
    const panel = screen.getByTestId('checkout-panel');
    expect(panel).toHaveTextContent(CHECKOUT);
    expect(screen.getByRole('button', { name: 'Paused for now' })).toBeDisabled();
    expect(screen.getByLabelText(/UPI · cards · netbanking/).closest('label')).toHaveTextContent(
      'Paused for now',
    );
    expect(panel).not.toHaveTextContent(/billed annually, starting today/);
  });

  it('keeps Razorpay paused when India Paddle prices are configured', () => {
    renderPanel('razorpay', { indiaCheckoutOpen: true });
    const panel = screen.getByTestId('checkout-panel');
    expect(panel).toHaveTextContent(CHECKOUT);
    expect(screen.getByRole('button', { name: 'Paused for now' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Continue to checkout' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/UPI · cards · netbanking/).closest('label')).toHaveTextContent(
      'Paused for now',
    );
  });

  it('pauses an INR Paddle quote while India price ids are not configured', () => {
    renderPanel('paddle', { pricingV2: true, country: 'IN' });
    const panel = screen.getByTestId('checkout-panel');
    expect(panel).toHaveTextContent(CHECKOUT);
    expect(panel).toHaveTextContent(/Reference price: ₹1,999/);
    expect(panel).not.toHaveTextContent(/billed yearly/);
    expect(screen.getByRole('button', { name: 'Paused for now' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Continue to checkout' })).not.toBeInTheDocument();
  });

  it('opens an INR Paddle quote when India checkout is available', () => {
    renderPanel('paddle', { pricingV2: true, country: 'IN', indiaCheckoutOpen: true });
    const panel = screen.getByTestId('checkout-panel');
    expect(panel).not.toHaveTextContent(CHECKOUT);
    expect(panel).toHaveTextContent(/₹1,999 billed yearly/);
    expect(screen.getByRole('button', { name: 'Continue to checkout' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Paused for now' })).not.toBeInTheDocument();
  });

  it('keeps a USD Paddle checkout open while rupee purchases are paused', () => {
    renderPanel('paddle', { pricingV2: true, country: 'US' });
    const panel = screen.getByTestId('checkout-panel');
    expect(panel).not.toHaveTextContent(CHECKOUT);
    expect(panel).toHaveTextContent(/\$59 billed yearly/);
    expect(screen.queryByRole('button', { name: 'Paused for now' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to checkout' })).toBeEnabled();
  });
});
