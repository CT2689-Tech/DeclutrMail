/**
 * India vs US price strings on every visitor-facing launch surface.
 *
 * IN: one currency, no `$`, Plus cadence present.
 * US: the strings already shipped after #1020 stay byte-identical.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import {
  fillStory,
  launchPriceDisplay,
  OFFERS,
  PLUS_ANNUAL_2026_10,
} from '@declutrmail/shared/entitlements';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { PricingTeaserStory } from '@/features/marketing/landing/pricing-teaser-launch';
import { PricingStory } from '@/features/marketing/pricing/pricing-story';

import { BillingCurrencyProvider } from './billing-currency';
import { launchPlusQuote } from './billing-model';
import { ConfirmPanel } from './checkout-confirm-panel';
import { PlanPicker } from './plan-picker';
import { TierGate } from './tier-gate';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/senders',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/features/auth/api/use-tier', () => ({
  useTier: () => ({
    tier: 'free',
    cleanupRemaining: 0,
    pricingV2: true,
    passEnabled: true,
  }),
}));

const US = launchPriceDisplay('usd');
const IN = launchPriceDisplay('inr');
const NOW = '2026-10-27T07:01:00.000Z';

function renderPicker(
  country: string | null,
  indiaCheckoutOpen: boolean,
  initialIntent: { plan: 'plus'; cycle: 'annual'; offer: 'pass_onetime' } | null = {
    plan: 'plus',
    cycle: 'annual',
    offer: 'pass_onetime',
  },
) {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <PlanPicker
        currentTier="free"
        grantingSub={null}
        disabled={false}
        initialIntent={initialIntent}
        pricingV2
        passEnabled
        country={country}
        indiaCheckoutOpen={indiaCheckoutOpen}
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

function renderConfirm(
  locale: { country: string | null; indiaCheckoutOpen: boolean },
  offer: 'pass_onetime' | null = null,
) {
  return render(
    <ConfirmPanel
      target="plus"
      cycle="annual"
      provider="paddle"
      razorpayOffered={false}
      pricingV2
      offer={offer}
      country={locale.country}
      indiaCheckoutOpen={locale.indiaCheckoutOpen}
      pricePointOverride={offer === 'pass_onetime' ? OFFERS.backlogPass.price : PLUS_ANNUAL_2026_10}
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

function PlanChips({ locale }: { locale: 'usd' | 'inr' }) {
  return (
    <div data-testid="plan-chips">
      <span>{fillStory(WS1_COPY['cap.plus.sublabel'], locale)}</span>
      <span>{fillStory(WS1_COPY['cap.pass.sublabel'], locale)}</span>
      <span>{launchPlusQuote('paddle', locale)}</span>
    </div>
  );
}

describe('visitor price surfaces — US stays the #1020 strings', () => {
  it('keeps every USD launch string unchanged', () => {
    expect(US).toEqual({
      free: { amount: '$0', per: '' },
      plus: { amount: '$59', per: '/yr' },
      plusLine: '$59 a year',
      passLine: '$19 once',
    });
    expect(launchPlusQuote()).toBe('$59 a year');
    expect(fillStory(WS1_COPY['cap.plus.sublabel'])).toBe('$59 a year · no monthly limit');
    expect(fillStory(WS1_COPY['cap.pass.sublabel'])).toBe(
      '$19 once · 30 days, one Gmail account · doesn’t renew',
    );
    expect(fillStory(WS1_COPY['refunds.pass'])).toBe(
      'If we refund a Backlog Pass, its 30 days with no monthly limit end when the refund is confirmed and your account returns to Free. Email you already cleared stays where you put it.',
    );
    expect(fillStory(WS1_COPY['terms.pass'])).toBe(
      'The Backlog Pass is a one-time payment for 30 days with no monthly limit on one Gmail account, and never renews. Buying another Backlog Pass adds 30 days to the end of your current one.',
    );
    expect(fillStory(WS1_COPY['billing.pass.statusDetail'], 'usd', { passEndDate: 'Nov 12' })).toBe(
      'No monthly limit on one Gmail account, plus the Screener and Autopilot, until Nov 12. Then you’re back on Free. Nothing renews.',
    );
  });

  it('renders /billing cards, confirm, /pricing, teaser, and chips in USD', async () => {
    const picker = renderPicker('US', false);
    // /billing's offer cards carry their own preview (no separate confirm).
    const offerPlus = screen.getByTestId('launch-offer-plus');
    const offerPass = screen.getByTestId('launch-offer-pass');
    expect(offerPlus).toHaveTextContent('$59');
    expect(offerPlus).toHaveTextContent('a year');
    expect(screen.getByTestId('launch-offer-plus-terms')).toHaveTextContent('$59 billed yearly');
    expect(offerPass).toHaveTextContent('$19');
    expect(offerPass).toHaveTextContent('once');
    await waitFor(() => expect(offerPass).toHaveFocus());
    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
    picker.unmount();

    renderConfirm({ country: 'US', indiaCheckoutOpen: false });
    const plusConfirm = screen.getByTestId('checkout-panel');
    expect(plusConfirm).toHaveTextContent('$59 billed yearly');
    expect(plusConfirm).toHaveTextContent('Before you pay');

    render(<PricingStory passEnabled locale="usd" now={NOW} />);
    expect(screen.getByTestId('pricing-story')).toHaveTextContent('$0');
    expect(screen.getByTestId('pricing-story')).toHaveTextContent('$59');
    expect(screen.getByTestId('pricing-story')).toHaveTextContent('a year');
    expect(screen.getByTestId('pricing-story')).toHaveTextContent('$19');

    render(<PricingTeaserStory passEnabled locale="usd" />);
    expect(screen.getByTestId('pricing-teaser-story')).toHaveTextContent('$59 a year');
    expect(screen.getByTestId('pricing-teaser-story')).toHaveTextContent('$19 once');

    render(<PlanChips locale="usd" />);
    expect(screen.getByTestId('plan-chips')).toHaveTextContent('$59 a year');
    expect(screen.getByTestId('plan-chips')).toHaveTextContent('$19 once');

    render(
      <BillingCurrencyProvider provider="paddle" locale="usd">
        <TierGate capability="screener" title="Screener" pitch="Review new senders.">
          <div>unlocked</div>
        </TierGate>
      </BillingCurrencyProvider>,
    );
    expect(
      screen.getByRole('link', { name: /^Upgrade to Plus\s*\$59 a year$/ }),
    ).toBeInTheDocument();
  });
});

describe('visitor price surfaces — India uses one currency', () => {
  it('derives every launch price from launchPriceDisplay', () => {
    expect(IN.free.amount).toBe('₹0');
    expect(IN.plus).toEqual({ amount: '₹1,999', per: '/yr' });
    expect(IN.plusLine).toBe('₹1,999 a year');
    expect(IN.passLine).toBe('₹799 once');
    expect(fillStory(WS1_COPY['cap.pass.sublabel'], 'inr')).toBe(
      '₹799 once · 30 days, one Gmail account · doesn’t renew',
    );
    expect(fillStory(WS1_COPY['cap.pass.sublabel'], 'inr')).not.toContain('$');
    expect(
      `${IN.free.amount}${IN.plus.amount}${IN.plus.per}${IN.plusLine}${IN.passLine}`,
    ).not.toContain('$');
  });

  it('quotes one INR catalog on plain /billing for a Free account (no offer params)', () => {
    renderPicker('IN', true, null);
    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
    const plus = screen.getByTestId('launch-offer-plus');
    const pass = screen.getByTestId('launch-offer-pass');
    expect(plus).toHaveTextContent('₹1,999');
    expect(plus).not.toHaveTextContent('incl. GST');
    expect(pass).toHaveTextContent('₹799');
    expect(pass).toHaveTextContent('once');
    expect(plus.textContent).not.toContain('$');
    expect(pass.textContent).not.toContain('$');
  });

  it('keeps USD on plain /billing for a US Free account (no offer params)', () => {
    renderPicker('US', false, null);
    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('launch-offer-plus')).toHaveTextContent('$59');
    expect(screen.getByTestId('launch-offer-pass')).toHaveTextContent('$19');
    expect(screen.getByTestId('launch-offer-plus').textContent).not.toContain('₹');
  });

  it('renders /billing cards, offer header, and confirm without $ and with Plus cadence', async () => {
    renderPicker('IN', true);
    const plus = screen.getByTestId('launch-offer-plus');
    const pass = screen.getByTestId('launch-offer-pass');
    expect(plus).toHaveTextContent('₹1,999');
    expect(plus).toHaveTextContent('a year');
    expect(plus).not.toHaveTextContent('incl. GST');
    expect(plus).not.toHaveTextContent('$');
    expect(screen.getByTestId('launch-offer-plus-terms')).toHaveTextContent('₹1,999 billed yearly');
    expect(pass).toHaveTextContent('₹799');
    expect(pass).not.toHaveTextContent('$');
    // The Pass deep link points at the Pass card; checkout opens on its button.
    await waitFor(() => expect(pass).toHaveFocus());
    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
  });

  it('renders the Plus confirm, /pricing, teaser, meter chips, and gate in INR', () => {
    renderConfirm({ country: 'IN', indiaCheckoutOpen: true });
    const confirm = screen.getByTestId('checkout-panel');
    expect(confirm).toHaveTextContent('₹1,999 billed yearly');
    expect(confirm.textContent).not.toContain('$');

    render(<PricingStory passEnabled locale="inr" now={NOW} rupeePurchasesOpen />);
    const pricing = screen.getByTestId('pricing-story');
    expect(pricing).toHaveTextContent('₹0');
    expect(pricing).toHaveTextContent('₹1,999');
    expect(pricing).toHaveTextContent('a year');
    expect(pricing).toHaveTextContent('₹799');
    expect(pricing.textContent).not.toContain('$');

    render(<PricingTeaserStory passEnabled locale="inr" />);
    const teaser = screen.getByTestId('pricing-teaser-story');
    expect(teaser).toHaveTextContent('₹1,999 a year');
    expect(teaser).toHaveTextContent('₹799 once');
    expect(teaser.textContent).not.toContain('$');

    render(<PlanChips locale="inr" />);
    const chips = screen.getByTestId('plan-chips');
    expect(chips).toHaveTextContent('₹1,999 a year · no monthly limit');
    expect(chips).toHaveTextContent('₹799 once');
    expect(chips).toHaveTextContent('₹1,999 a year');
    expect(chips.textContent).not.toContain('$');

    render(
      <BillingCurrencyProvider provider="paddle" locale="inr">
        <TierGate capability="screener" title="Screener" pitch="Review new senders.">
          <div>unlocked</div>
        </TierGate>
      </BillingCurrencyProvider>,
    );
    expect(
      screen.getByRole('link', { name: /^Upgrade to Plus\s*₹1,999 a year$/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('tier-gate-placeholder').textContent).not.toContain('$');
  });
});
