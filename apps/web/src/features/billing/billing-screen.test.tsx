/**
 * Tests for `BillingScreen` (D119/D120/D121).
 *
 * Covers the designed states — loading, billing-disabled 503 (honest
 * notice, NOT an error), error — plus the loaded branches (free tier,
 * paid subscriber, founding member, scheduled cancel) and the two
 * flows: change-plan → checkout (exact D117 contract body asserted)
 * and cancel preview → confirm (D118/D120/D121 copy pinned).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

let mockTier = 'free';
let mockCleanupRemaining: number | null = 3;
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
      tier: mockTier,
      cleanupRemaining: mockCleanupRemaining,
    },
  }),
}));

// Provider launch is a side-effect seam (Paddle overlay / Razorpay
// navigation) — stub it; the checkout CONTRACT is asserted on the wire.
vi.mock('@/features/billing/checkout', () => ({
  launchCheckout: vi.fn(() => Promise.resolve()),
}));

import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { launchCheckout } from './checkout';
import { BillingScreen } from './billing-screen';

const FREE_BODY: BillingSubscription = { tier: 'free', foundingMember: false, subscription: null };

const SUB: NonNullable<BillingSubscription['subscription']> = {
  provider: 'paddle',
  tier: 'pro',
  status: 'active',
  cycle: 'monthly',
  currentPeriodEnd: '2026-07-01T12:00:00.000Z',
  cancelAtPeriodEnd: false,
  pauseUntil: null,
  foundingMember: false,
};

const PRO_SUB: BillingSubscription = { tier: 'pro', foundingMember: false, subscription: SUB };

const PLUS_SUB: BillingSubscription = {
  tier: 'plus',
  foundingMember: false,
  subscription: { ...SUB, tier: 'plus' },
};

function billingDisabled503(): Response {
  return new Response(
    JSON.stringify({
      error: { code: 'BILLING_DISABLED', message: 'Billing is not available yet.' },
    }),
    { status: 503, headers: { 'content-type': 'application/json' } },
  );
}

function stubSubscription(respond: () => Response | Promise<Response>) {
  installFetchStub([{ method: 'GET', path: '/api/billing/subscription', respond }]);
}

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <BillingScreen />
    </QueryWrapper>,
  );
}

beforeEach(() => {
  mockTier = 'free';
  mockCleanupRemaining = 3;
  vi.mocked(launchCheckout).mockClear();
});

afterEach(() => resetFetchStub());

describe('BillingScreen — designed states', () => {
  it('shows a loading skeleton while the subscription fetch is in flight', () => {
    stubSubscription(() => new Promise<Response>(() => {}));
    renderScreen();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('503 BILLING_DISABLED renders the honest dark-state, not an error', async () => {
    stubSubscription(billingDisabled503);
    renderScreen();

    expect(await screen.findByTestId('billing-disabled-notice')).toBeInTheDocument();
    // Plan card still renders from the `me` tier…
    const card = screen.getByTestId('current-plan-card');
    expect(within(card).getByText('Free')).toBeInTheDocument();
    // …but checkout/cancel affordances are withheld while dark.
    expect(screen.queryByRole('button', { name: 'Change plan' })).not.toBeInTheDocument();
    // The strip + pricing link stay (plans are final, D119).
    expect(screen.getByTestId('tier-strip-pro')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the full comparison →' })).toHaveAttribute(
      'href',
      '/pricing',
    );
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });

  it('renders the error branch with retry on a 500', async () => {
    stubSubscription(() => jsonServerError());
    renderScreen();
    expect(await screen.findByText("We couldn't load your billing details")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('BillingScreen — free tier (billing live)', () => {
  it('plan card: Free, $0, lifetime cleanup actions left, change-plan CTA', async () => {
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen();

    const card = await screen.findByTestId('current-plan-card');
    expect(within(card).getByText('Free')).toBeInTheDocument();
    expect(within(card).getByText('$0')).toBeInTheDocument();
    expect(within(card).getByText('3 of 5 lifetime cleanup actions left.')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Change plan' })).toBeInTheDocument();
    expect(
      within(card).queryByRole('button', { name: 'Cancel subscription' }),
    ).not.toBeInTheDocument();
    // Strip marks Free as current.
    expect(within(screen.getByTestId('tier-strip-free')).getByText('Current')).toBeInTheDocument();
  });

  it('change plan → Pro annual + Founding Pro → POSTs the exact D117 contract body', async () => {
    let checkoutBody: unknown = null;
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
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
              priceId: 'pri_test_123',
              clientToken: 'test_token',
              environment: 'sandbox',
              customData: { workspaceId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff' },
            },
          });
        },
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Change plan' }));
    const modal = screen.getByTestId('plan-change-modal');
    expect(
      within(modal).getByRole('button', { name: 'Close plan change dialog' }),
    ).toHaveTextContent('Close');
    fireEvent.click(within(modal).getByTestId('plan-option-pro'));

    const panel = within(modal).getByTestId('checkout-panel');
    // Defaults: annual cycle, Paddle provider, Founding Pro claimed.
    expect(within(panel).getByRole('checkbox')).toBeChecked();
    expect(within(panel).getByText(/Claim Founding Pro — \$129\/yr/)).toBeInTheDocument();
    expect(within(panel).getByText(/\$129 billed annually, starting today/)).toBeInTheDocument();
    expect(within(panel).getByText('30-day money-back guarantee')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Continue to checkout →' }));

    await waitFor(() =>
      expect(checkoutBody).toEqual({
        tierId: 'pro',
        cycle: 'annual',
        provider: 'paddle',
        promo: 'foundingPro',
      }),
    );
    await waitFor(() => expect(launchCheckout).toHaveBeenCalledTimes(1));
    expect(vi.mocked(launchCheckout).mock.calls[0]?.[0]).toMatchObject({
      provider: 'paddle',
      priceId: 'pri_test_123',
      customData: { workspaceId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff' },
    });
  });

  it('monthly cycle drops the promo; Razorpay pick rides the body (D117)', async () => {
    let checkoutBody: unknown = null;
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
              provider: 'razorpay',
              kind: 'hosted',
              subscriptionId: 'sub_test',
              shortUrl: 'https://rzp.io/i/test',
              keyId: 'rzp_test_key',
            },
          });
        },
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Change plan' }));
    const modal = screen.getByTestId('plan-change-modal');
    fireEvent.click(within(modal).getByRole('button', { name: 'Monthly' }));
    fireEvent.click(within(modal).getByTestId('plan-option-pro'));

    const panel = within(modal).getByTestId('checkout-panel');
    expect(within(panel).queryByText(/Founding Pro/)).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByLabelText(/UPI · cards · netbanking/));
    fireEvent.click(within(panel).getByRole('button', { name: 'Continue to checkout →' }));

    await waitFor(() =>
      expect(checkoutBody).toEqual({ tierId: 'pro', cycle: 'monthly', provider: 'razorpay' }),
    );
  });

  it('checkout 503 surfaces the honest billing-dark message inline', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: FREE_BODY }),
      },
      { method: 'POST', path: '/api/billing/checkout', respond: billingDisabled503 },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Change plan' }));
    const modal = screen.getByTestId('plan-change-modal');
    fireEvent.click(within(modal).getByTestId('plan-option-plus'));
    fireEvent.click(within(modal).getByRole('button', { name: 'Continue to checkout →' }));

    expect(
      await within(modal).findByText(
        'Billing isn’t switched on yet — checkout opens here once it goes live.',
      ),
    ).toBeInTheDocument();
    expect(launchCheckout).not.toHaveBeenCalled();
  });
});

describe('BillingScreen — paid subscriber', () => {
  it('plan card: tier, price, renewal, provider, cancel affordance', async () => {
    mockTier = 'pro';
    mockCleanupRemaining = null;
    stubSubscription(() => jsonOk({ data: PRO_SUB }));
    renderScreen();

    const card = await screen.findByTestId('current-plan-card');
    expect(within(card).getByText('Pro')).toBeInTheDocument();
    expect(within(card).getByText('$19/mo')).toBeInTheDocument();
    expect(within(card).getByText('· Next renewal Jul 1, 2026')).toBeInTheDocument();
    expect(within(card).getByText('· via Paddle')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Cancel subscription' })).toBeInTheDocument();
  });

  it('founding member: banner with the locked manifest price', async () => {
    mockTier = 'pro';
    stubSubscription(() =>
      jsonOk({
        data: {
          ...PRO_SUB,
          foundingMember: true,
          subscription: { ...SUB, cycle: 'annual', foundingMember: true },
        },
      }),
    );
    renderScreen();

    const banner = await screen.findByTestId('founding-banner');
    expect(within(banner).getByText('Founding Pro member')).toBeInTheDocument();
    expect(within(banner).getByText(/price locked at \$129\/yr/)).toBeInTheDocument();
  });

  it('cancel flow: preview copy (D120/D121) → confirm posts reason → card updates', async () => {
    mockTier = 'pro';
    let cancelBody: unknown = null;
    const canceled: BillingSubscription = {
      ...PRO_SUB,
      subscription: { ...SUB, cancelAtPeriodEnd: true },
    };
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PRO_SUB }),
      },
      {
        method: 'POST',
        path: '/api/billing/cancel',
        respond: async (req) => {
          cancelBody = await req.json();
          return jsonOk({ data: canceled });
        },
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }));
    const modal = screen.getByTestId('cancel-modal');
    // D120 downgrade terms + D121 money-back route (all paid tiers).
    expect(
      within(modal).getByText('Your Pro features stay active until Jul 1, 2026.'),
    ).toBeInTheDocument();
    // Canceling is framed honestly as "not a refund" instead of the old
    // misleading "No refund for unused time" absolute.
    expect(within(modal).getByText(/on its own it isn.t\s+a refund/i)).toBeInTheDocument();
    expect(within(modal).getByText(/Every paid plan includes a/)).toBeInTheDocument();
    expect(within(modal).getByText(/30-day money-back guarantee/)).toBeInTheDocument();
    const refundLink = within(modal).getByRole('link', { name: /Request a refund/ });
    expect(refundLink.getAttribute('href')).toContain('mailto:support@declutrmail.com');

    fireEvent.change(within(modal).getByRole('combobox'), { target: { value: 'too_expensive' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Cancel subscription' }));

    await waitFor(() => expect(cancelBody).toEqual({ reason: 'too_expensive' }));
    // Cache write-back: scheduled-cancel note renders; affordance gone.
    expect(
      await screen.findByText(
        "Cancellation scheduled — your plan stays active until Jul 1, 2026, then you'll switch to Free.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel subscription' })).not.toBeInTheDocument();
  });

  it('cancel modal surfaces the money-back guarantee + refund request for a PLUS subscriber (D121, all paid tiers)', async () => {
    mockTier = 'plus';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PLUS_SUB }),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }));
    const modal = screen.getByTestId('cancel-modal');
    expect(
      within(modal).getByText('Your Plus features stay active until Jul 1, 2026.'),
    ).toBeInTheDocument();
    // The refund right is shown to Plus too — the honesty bug this fixes
    // (previously gated behind `tier === 'pro'`, so Plus never saw it).
    expect(within(modal).getByText(/Every paid plan includes a/)).toBeInTheDocument();
    expect(within(modal).getByText(/30-day money-back guarantee/)).toBeInTheDocument();
    const refundLink = within(modal).getByRole('link', { name: /Request a refund/ });
    const href = refundLink.getAttribute('href') ?? '';
    expect(href).toContain('mailto:support@declutrmail.com');
    expect(href).toMatch(/subject=/);
  });

  it('cancel error does not persist after closing and reopening the modal', async () => {
    mockTier = 'pro';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PRO_SUB }),
      },
      { method: 'POST', path: '/api/billing/cancel', respond: () => jsonServerError() },
    ]);
    renderScreen();

    // Open → confirm → the POST fails → inline error renders.
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }));
    let modal = screen.getByTestId('cancel-modal');
    fireEvent.click(within(modal).getByRole('button', { name: 'Cancel subscription' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent(
      'Cancellation could not be processed. Please try again.',
    );

    // Close ("Keep my plan") then reopen — the stale error must be gone.
    fireEvent.click(within(modal).getByRole('button', { name: 'Keep my plan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }));
    modal = screen.getByTestId('cancel-modal');
    expect(within(modal).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('change plan → Free shows the D120 downgrade panel routing to cancel', async () => {
    mockTier = 'pro';
    stubSubscription(() => jsonOk({ data: PRO_SUB }));
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Change plan' }));
    const modal = screen.getByTestId('plan-change-modal');
    fireEvent.click(within(modal).getByTestId('plan-option-free'));

    const panel = within(modal).getByTestId('downgrade-panel');
    expect(
      within(panel).getByText(/Your Pro features will remain active until Jul 1, 2026\./),
    ).toBeInTheDocument();
    // Downgrade copy points at the cancel step's money-back guarantee
    // rather than the old misleading "No refund for unused time" line.
    expect(
      within(panel).getByText(/the next step covers cancellation, including the 30-day money-back/),
    ).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Continue to cancellation →' }));
    expect(screen.getByTestId('cancel-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-change-modal')).not.toBeInTheDocument();
  });

  it('change plan → other paid tier states the honest no-self-serve path', async () => {
    mockTier = 'pro';
    stubSubscription(() => jsonOk({ data: PRO_SUB }));
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Change plan' }));
    const modal = screen.getByTestId('plan-change-modal');
    fireEvent.click(within(modal).getByTestId('plan-option-plus'));

    expect(within(modal).getByTestId('paid-switch-panel')).toBeInTheDocument();
    expect(within(modal).queryByTestId('checkout-panel')).not.toBeInTheDocument();
  });
});
