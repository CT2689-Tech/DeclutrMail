/**
 * Plan picker checks that run through the real billing screen: the
 * current-plan headline makes no price claim without a backing
 * subscription, and the Founding Pro offer follows live availability.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/auth/auth-provider', () => {
  const auth = () => ({
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
  });
  return { useAuth: auth, useOptionalAuth: auth };
});

vi.mock('@/features/billing/checkout', () => ({
  launchCheckout: vi.fn(() => Promise.resolve()),
}));

import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { BillingScreen } from './billing-screen';

const FREE_BODY: BillingSubscription = {
  checkoutSetupComplete: true,
  complimentary: null,
  tier: 'free',
  foundingMember: false,
  subscription: null,
  pendingCheckout: null,
};

let subscriptionBody: BillingSubscription = FREE_BODY;

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <BillingScreen initialIntent={null} />
    </QueryWrapper>,
  );
}

beforeEach(() => {
  subscriptionBody = FREE_BODY;
  window.localStorage.clear();
  installFetchStub([
    {
      method: 'GET',
      path: '/api/billing/subscription',
      respond: () => jsonOk({ data: subscriptionBody }),
    },
  ]);
});

afterEach(() => resetFetchStub());

describe('the current-plan headline makes no price claim without a backing sub (A6)', () => {
  // Supersedes the "headline quotes the strip's rail" tests: an
  // unbacked paid tier used to render quotedPlanPrice as its current
  // price — a charge nobody pays. The headline now claims no price at
  // all, so it can never disagree with the strip either.
  it('reads NO price for an unbacked paid tier', async () => {
    subscriptionBody = {
      complimentary: null,
      tier: 'pro',
      foundingMember: false,
      subscription: null,
      pendingCheckout: null,
    };
    renderScreen();

    const card = await screen.findByTestId('current-plan-card');
    expect(card).toHaveTextContent('Included with your account');
    expect(card).not.toHaveTextContent('$19/mo');
  });
});

// QA-billing-20260901-05/-09 — the Founding Pro price/checkbox is now
// gated on live availability (`GET /api/billing/founding-remaining`),
// not offered unconditionally until a 409 at confirm.
describe('Founding Pro availability gate', () => {
  it('shows the founding price on the Pro card, and the checkbox, while spots remain', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: subscriptionBody }),
      },
      {
        method: 'GET',
        path: '/api/billing/founding-remaining',
        respond: () => jsonOk({ data: { remaining: 12 } }),
      },
    ]);
    renderScreen();

    const proCard = await screen.findByTestId('plan-option-pro');
    expect(await within(proCard).findByText(/Founding Pro:/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    const panel = await screen.findByTestId('checkout-panel');
    expect(within(panel).getByRole('checkbox')).toBeInTheDocument();
  });

  it('hides the founding price and the checkbox once the 250 slots are gone', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: subscriptionBody }),
      },
      {
        method: 'GET',
        path: '/api/billing/founding-remaining',
        respond: () => jsonOk({ data: { remaining: 0 } }),
      },
    ]);
    renderScreen();

    const proCard = await screen.findByTestId('plan-option-pro');
    // `waitFor` retries until the availability read resolves — a
    // one-shot `queryByText` here could pass on "hasn't loaded yet"
    // rather than on the confirmed sold-out state.
    await waitFor(() => expect(within(proCard).queryByText(/Founding Pro:/)).toBeNull());

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    const panel = await screen.findByTestId('checkout-panel');
    expect(within(panel).queryByRole('checkbox')).toBeNull();
  });
});
