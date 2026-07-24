/**
 * The provider gate under a PARTIALLY provisioned Razorpay catalog
 * (D117).
 *
 * Today every `razorpayPlanId` is null, so the radio never renders and
 * `provider` can only ever be `paddle` — which is exactly what hides
 * the bug this file guards. Standard annual and the Founding Pro promo
 * are SEPARATE price points with separate catalog ids, and the promo
 * checkbox swaps between them WITHOUT remounting the confirm panel. So
 * the day Razorpay ships for standard annual but not the promo, a pick
 * made while the radio was visible would survive the radio's removal
 * and ride a promo checkout with no Razorpay id — a
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

// Pro ANNUAL gains a Razorpay id; the Founding Pro promo does not.
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
          ...pro.prices,
          annual: { ...pro.prices.annual!, razorpayPlanId: 'plan_test_pro_annual' },
        },
      },
    },
  };
});

import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { BillingScreen } from './billing-screen';

const FREE_BODY: BillingSubscription = { tier: 'free', foundingMember: false, subscription: null };

let checkoutBody: unknown = null;

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <BillingScreen initialIntent={null} />
    </QueryWrapper>,
  );
}

beforeEach(() => {
  checkoutBody = null;
  window.localStorage.clear();
  installFetchStub([
    {
      method: 'GET',
      path: '/api/billing/subscription',
      respond: () => jsonOk({ data: FREE_BODY }),
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

    // Standard Pro annual — drop the promo claim to reach that point.
    fireEvent.click(within(panel).getByRole('checkbox'));
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

    // Standard annual → Razorpay is offered; pick it.
    fireEvent.click(within(panel).getByRole('checkbox'));
    fireEvent.click(within(panel).getByLabelText(/UPI · cards · netbanking/));

    // Re-claim Founding Pro — a DIFFERENT price point, with no Razorpay
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
