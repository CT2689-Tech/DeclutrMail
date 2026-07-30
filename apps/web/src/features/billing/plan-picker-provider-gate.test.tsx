/**
 * The provider gate under a PARTIALLY provisioned Razorpay catalog
 * (D117).
 *
 * While India was deferred every `razorpayPlanId` was null, so the radio
 * never rendered and `provider` could only ever be `paddle` — which is
 * exactly what hid the bug this file guards. Razorpay went live
 * 2026-07-25, so the radio now renders for real. Standard annual and the
 * Founding Pro promo are SEPARATE price points with separate catalog ids,
 * and the promo checkbox swaps between them WITHOUT remounting the
 * confirm panel. So whenever Razorpay covers standard annual but not the
 * promo, a pick made while the radio was visible would survive the
 * radio's removal and ride a promo checkout with no Razorpay id — a
 * BILLING_NOT_PROVISIONED dead end at the moment of purchase.
 *
 * The manifest is mocked (not the component) so the assertion is about
 * catalog provisioning, which is what actually varies in production.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Entitlements from '@declutrmail/shared/entitlements';

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    me: {
      user: { id: 'u', email: 'me@example.com', workspaceId: 'w' },
      activeMailboxId: 'mb-1',
      mailboxes: [
        {
          id: 'mb-1',
          email: 'me@example.com',
          status: 'active',
          connectedAt: null,
          readiness: 'ready',
        },
      ],
      tier: 'free',
      cleanupRemaining: 3,
    },
  }),
}));

vi.mock('@/features/billing/checkout', () => ({
  launchCheckout: vi.fn(() => Promise.resolve()),
}));

// Pro MONTHLY and ANNUAL carry a Razorpay id; the Founding Pro promo is
// explicitly NULLED. The promo being unprovisioned is the whole point —
// it is what makes "which point did this label clamp against?" an
// answerable question.
//
// The null is set here rather than inherited from the real manifest:
// when the live Razorpay catalog landed (2026-07-25) every real id became
// non-null, and a fixture leaning on the real one would have quietly
// stopped testing the thing it was written for.
vi.mock('@declutrmail/shared/entitlements', async (importOriginal) => {
  const actual = await importOriginal<typeof Entitlements>();
  const pro = actual.TIER_MANIFEST.pro;
  return {
    ...actual,
    TIER_MANIFEST: {
      ...actual.TIER_MANIFEST,
      pro: {
        ...pro,
        prices: {
          monthly: { ...pro.prices.monthly!, razorpayPlanId: 'plan_test_pro_monthly' },
          annual: { ...pro.prices.annual!, razorpayPlanId: 'plan_test_pro_annual' },
        },
        promo: { ...pro.promo!, annual: { ...pro.promo!.annual, razorpayPlanId: null } },
      },
    },
  };
});

import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { BillingScreen } from './billing-screen';

const FREE_BODY: BillingSubscription = {
  tier: 'free',
  foundingMember: false,
  subscription: null,
  pendingCheckout: null,
};

let checkoutBody: unknown = null;
let subscriptionBody: BillingSubscription = FREE_BODY;

function renderScreen(props: { initialProvider?: 'paddle' | 'razorpay' } = {}) {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <BillingScreen initialIntent={null} {...props} />
    </QueryWrapper>,
  );
}

beforeEach(() => {
  checkoutBody = null;
  subscriptionBody = FREE_BODY;
  window.localStorage.clear();
  installFetchStub([
    {
      method: 'GET',
      path: '/api/billing/subscription',
      respond: () => jsonOk({ data: subscriptionBody }),
    },
    {
      method: 'POST',
      path: '/api/billing/checkout',
      respond: async (req) => {
        checkoutBody = await req.json();
        return jsonOk({
          data: {
            provider: 'paddle',
            kind: 'overlay',
            priceId: 'pri_test',
            clientToken: 'test_token',
            environment: 'sandbox',
            customData: { workspace_id: 'ws-1', sig: 'test-sig' },
          },
        });
      },
    },
  ]);
});

afterEach(() => resetFetchStub());

describe('checkout provider gate (D117)', () => {
  it('offers Razorpay on a price point that carries a Razorpay id', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    const panel = screen.getByTestId('checkout-panel');

    // Founding Pro now defaults OFF — the claim is an opt-in, so standard
    // annual is where the picker already stands. Asserted rather than
    // clicked: this used to click the box to UNCHECK it, which silently
    // encoded the old default-on and inverted the moment it changed.
    expect(within(panel).getByRole('checkbox')).not.toBeChecked();
    expect(within(panel).getByLabelText(/UPI · cards · netbanking/)).toBeInTheDocument();

    fireEvent.click(within(panel).getByLabelText(/UPI · cards · netbanking/));
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );

    await waitFor(() =>
      expect(checkoutBody).toEqual({ tierId: 'pro', cycle: 'annual', provider: 'razorpay' }),
    );
  });

  it('a Razorpay pick never outlives the price point that offered it', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    const panel = screen.getByTestId('checkout-panel');

    // Standard annual (the default) → Razorpay is offered; pick it.
    expect(within(panel).getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(within(panel).getByLabelText(/UPI · cards · netbanking/));

    // Claim Founding Pro — a DIFFERENT price point, with no Razorpay
    // id. The radio goes away; the stale pick must not survive it.
    fireEvent.click(within(panel).getByRole('checkbox'));
    expect(within(panel).queryByLabelText(/UPI · cards · netbanking/)).not.toBeInTheDocument();

    fireEvent.click(
      within(panel).getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );

    await waitFor(() =>
      expect(checkoutBody).toEqual({
        tierId: 'pro',
        cycle: 'annual',
        provider: 'paddle',
        promo: 'foundingPro',
      }),
    );
  });
});

describe('checkout currency (D117/D226)', () => {
  it('the preview quotes the currency the SELECTED provider will charge', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    const panel = screen.getByTestId('checkout-panel');

    // Founding Pro is unprovisioned on Razorpay in this fixture. The claim
    // defaults OFF, so the picker already stands on the standard annual
    // point that IS provisioned.
    expect(within(panel).getByRole('checkbox')).not.toBeChecked();
    expect(panel).toHaveTextContent(/\$190 billed annually/);

    fireEvent.click(within(panel).getByLabelText(/UPI · cards · netbanking/));

    // The D226 preview is the "exactly what happens" step. Quoting $190
    // and then charging ₹15,999 is the preview lying about the one
    // number it exists to state.
    expect(panel).toHaveTextContent(/₹15,999 billed annually/);
    expect(panel).not.toHaveTextContent(/\$190 billed annually/);
  });

  it('switching back to Paddle restores USD', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    const panel = screen.getByTestId('checkout-panel');
    expect(within(panel).getByRole('checkbox')).not.toBeChecked();

    fireEvent.click(within(panel).getByLabelText(/UPI · cards · netbanking/));
    expect(panel).toHaveTextContent(/₹15,999/);
    fireEvent.click(within(panel).getByLabelText(/Card · PayPal · Apple Pay/));
    expect(panel).toHaveTextContent(/\$190 billed annually/);
  });

  it('an India-defaulted picker opens on Razorpay + INR without a click', async () => {
    renderScreen({ initialProvider: 'razorpay' });
    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    const panel = screen.getByTestId('checkout-panel');
    expect(within(panel).getByRole('checkbox')).not.toBeChecked();

    expect(within(panel).getByLabelText(/UPI · cards · netbanking/)).toBeChecked();
    expect(panel).toHaveTextContent(/₹15,999 billed annually/);
  });

  it('the Founding Pro claim quotes ITS OWN point, not the one on screen', async () => {
    // The claim label and the charge line describe DIFFERENT price
    // points. Standing on standard annual (Razorpay-provisioned, INR),
    // the promo below it is Paddle-only — so it must say $129. Reading
    // the standard point's currency printed "Claim Founding Pro —
    // ₹10,999/yr" over a checkout that charges $129.
    renderScreen({ initialProvider: 'razorpay' });
    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    const panel = screen.getByTestId('checkout-panel');

    expect(within(panel).getByRole('checkbox')).not.toBeChecked();
    expect(panel).toHaveTextContent(/₹15,999 billed annually/);

    const claim = within(panel).getByText(/Claim Founding Pro/);
    expect(claim).toHaveTextContent('$129/yr');
    expect(claim).not.toHaveTextContent('₹10,999');
  });
});

describe('the current-plan headline makes no price claim without a backing sub (A6)', () => {
  // Supersedes the "headline quotes the strip's rail" tests: an
  // unbacked paid tier used to render quotedPlanPrice as its current
  // price — a charge nobody pays. The headline now claims no price at
  // all, on ANY rail, so it can never disagree with the strip either.
  it('an India-routed visitor reads NO price for an unbacked paid tier', async () => {
    subscriptionBody = {
      tier: 'pro',
      foundingMember: false,
      subscription: null,
      pendingCheckout: null,
    };
    renderScreen({ initialProvider: 'razorpay' });

    const card = await screen.findByTestId('current-plan-card');
    expect(card).toHaveTextContent('Included with your account');
    expect(card).not.toHaveTextContent('₹1,599/mo');
    expect(card).not.toHaveTextContent('$19/mo');
  });

  it('same for a visitor outside India', async () => {
    subscriptionBody = {
      tier: 'pro',
      foundingMember: false,
      subscription: null,
      pendingCheckout: null,
    };
    renderScreen({ initialProvider: 'paddle' });

    const card = await screen.findByTestId('current-plan-card');
    expect(card).toHaveTextContent('Included with your account');
    expect(card).not.toHaveTextContent('$19/mo');
  });
});
