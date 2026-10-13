import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as BillingAvailability from '@declutrmail/shared/contracts/billing-availability';
import { PLUS_ANNUAL_2026_10 } from '@declutrmail/shared/entitlements';

import { ConfirmPanel } from './checkout-confirm-panel';

const flags = vi.hoisted(() => ({ paused: true }));

vi.mock('@declutrmail/shared/contracts/billing-availability', async (importOriginal) => {
  const actual = await importOriginal<typeof BillingAvailability>();
  return {
    ...actual,
    get INR_NEW_PURCHASES_PAUSED() {
      return flags.paused;
    },
    inrNewPurchasePaused(provider: 'paddle' | 'razorpay', currency: 'INR' | 'USD') {
      return flags.paused && (provider === 'razorpay' || currency === 'INR');
    },
  };
});

const CHECKOUT =
  'Buying a plan in rupees is paused for now. Email support@declutrmail.com for help.';

function renderPanel(
  provider: 'razorpay' | 'paddle' = 'razorpay',
  options?: { pricingV2?: boolean; country?: string | null },
) {
  return render(
    <ConfirmPanel
      target="plus"
      cycle="annual"
      provider={provider}
      razorpayOffered={!options?.pricingV2}
      pricingV2={options?.pricingV2 ?? false}
      country={options?.country ?? null}
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

beforeEach(() => {
  flags.paused = true;
});

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

  it('keeps the open checkout line and Razorpay detail when purchases are not paused', () => {
    flags.paused = false;
    renderPanel('razorpay');
    const panel = screen.getByTestId('checkout-panel');
    expect(panel).not.toHaveTextContent(CHECKOUT);
    expect(screen.queryByRole('button', { name: 'Paused for now' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to checkout' })).toBeEnabled();
    expect(screen.getByLabelText(/UPI · cards · netbanking/).closest('label')).toHaveTextContent(
      'Prices in rupees',
    );
    expect(panel).toHaveTextContent(/billed annually, starting today/);
  });

  it('pauses an INR Paddle quote while new rupee purchases are paused', () => {
    renderPanel('paddle', { pricingV2: true, country: 'IN' });
    const panel = screen.getByTestId('checkout-panel');
    expect(panel).toHaveTextContent(CHECKOUT);
    expect(panel).toHaveTextContent(/Reference price: ₹1,999/);
    expect(panel).not.toHaveTextContent(/billed yearly/);
    expect(screen.getByRole('button', { name: 'Paused for now' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Continue to checkout' })).not.toBeInTheDocument();
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
