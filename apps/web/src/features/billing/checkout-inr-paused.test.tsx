import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PLUS_ANNUAL_2026_10 } from '@declutrmail/shared/entitlements';

import { ConfirmPanel } from './checkout-confirm-panel';

const CHECKOUT =
  'Buying a plan in rupees is paused for now. Email support@declutrmail.com for help.';

function renderPanel(options?: { country?: string | null; indiaCheckoutOpen?: boolean }) {
  return render(
    <ConfirmPanel
      target="plus"
      country={options?.country ?? null}
      indiaCheckoutOpen={options?.indiaCheckoutOpen ?? false}
      pricePoint={PLUS_ANNUAL_2026_10}
      isPending={false}
      errorMessage={null}
      onConfirm={() => undefined}
      onDismiss={() => undefined}
    />,
  );
}

describe('INR pause copy on checkout confirm', () => {
  it('quotes USD for an India Paddle checkout while India prices are not open', () => {
    renderPanel({ country: 'IN' });
    const panel = screen.getByTestId('checkout-panel');
    expect(panel).not.toHaveTextContent(CHECKOUT);
    expect(panel).toHaveTextContent(/\$59 billed yearly/);
    expect(panel).not.toHaveTextContent('₹1,999');
    expect(screen.getByRole('button', { name: 'Continue to checkout' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Paused for now' })).not.toBeInTheDocument();
  });

  it('opens an INR Paddle quote when India checkout is available', () => {
    renderPanel({ country: 'IN', indiaCheckoutOpen: true });
    const panel = screen.getByTestId('checkout-panel');
    expect(panel).not.toHaveTextContent(CHECKOUT);
    expect(panel).toHaveTextContent(/₹1,999 billed yearly/);
    expect(screen.getByRole('button', { name: 'Continue to checkout' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Paused for now' })).not.toBeInTheDocument();
  });

  it('keeps a USD Paddle checkout open while rupee purchases are paused', () => {
    renderPanel({ country: 'US' });
    const panel = screen.getByTestId('checkout-panel');
    expect(panel).not.toHaveTextContent(CHECKOUT);
    expect(panel).toHaveTextContent(/\$59 billed yearly/);
    expect(screen.queryByRole('button', { name: 'Paused for now' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to checkout' })).toBeEnabled();
  });
});
