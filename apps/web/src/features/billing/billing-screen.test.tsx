/**
 * Tests for `BillingScreen` (D117/D119/D120/D121).
 *
 * Covers the designed states — loading, billing-disabled 503 (honest
 * notice, NOT an error), error — plus the loaded branches (free tier,
 * paid subscriber, founding member, scheduled cancel) and the flows:
 *
 *   - the inline picker's TWO-CLICK upgrade (plan CTA → D226 confirm →
 *     provider launch, exact D117 contract body asserted);
 *   - the one-tap monthly↔annual toggle re-pricing every card with the
 *     manifest-derived savings badge;
 *   - the truthful post-checkout state: Paddle `checkout.completed`
 *     shows PAYMENT PROCESSING and only the polled subscription read
 *     flipping the tier clears it (§10 — no optimistic tier);
 *   - cancel preview → confirm (D118/D120/D121 copy pinned).
 *
 * Every dollar assertion derives from TIER_MANIFEST via the same
 * helpers the screen uses — a manifest re-price re-prices this file.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
// navigation) — stub it; the checkout CONTRACT is asserted on the wire
// and the overlay lifecycle is driven through the captured events arg.
vi.mock('@/features/billing/checkout', () => ({
  launchCheckout: vi.fn(() => Promise.resolve()),
}));

import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { launchCheckout, type CheckoutEvents } from './checkout';
import type { BillingIntent } from './billing-intent';
import { annualMonthsFree, planPriceLabel } from './billing-model';
import { BillingScreen } from './billing-screen';
import { PENDING_CHECKOUT_KEY, writePendingCheckout } from './pending-checkout';

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

/** Manifest-derived labels the picker must render (never literals). */
const ANNUAL_TOGGLE = `Annual — ${annualMonthsFree('pro')} months free`;

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

function renderScreen(initialIntent: BillingIntent | null = null) {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <BillingScreen initialIntent={initialIntent} />
    </QueryWrapper>,
  );
}

/** The overlay-lifecycle callbacks the screen registered on launch. */
function capturedCheckoutEvents(): CheckoutEvents {
  const events = vi.mocked(launchCheckout).mock.calls[0]?.[1];
  expect(events?.onCompleted).toBeTypeOf('function');
  return events!;
}

beforeEach(() => {
  mockTier = 'free';
  mockCleanupRemaining = 3;
  vi.mocked(launchCheckout).mockClear();
  // The pending-payment lock persists in localStorage by design — a
  // leaked record from one test must not lock the next one's picker.
  window.localStorage.clear();
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
    renderScreen({ plan: 'pro', cycle: 'annual', promo: 'foundingPro' });

    expect(await screen.findByTestId('billing-disabled-notice')).toBeInTheDocument();
    // Plan card still renders from the `me` tier…
    const card = screen.getByTestId('current-plan-card');
    expect(within(card).getByText('Free')).toBeInTheDocument();
    // …and the picker keeps the plans visible (they're final, D119) but
    // withholds every checkout affordance — even against a deep link.
    expect(screen.getByTestId('plan-option-pro')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade to/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the full comparison →' })).toHaveAttribute(
      'href',
      '/pricing',
    );
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders an alert on 500 and recovers billing details when Retry succeeds', async () => {
    let attempts = 0;
    stubSubscription(() => {
      attempts += 1;
      return attempts === 1 ? jsonServerError() : jsonOk({ data: FREE_BODY });
    });
    renderScreen();

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: "We couldn't load your billing details" }),
    ).toBeInTheDocument();
    expect(within(alert).getByText(/no charge or plan change was made/i)).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    const card = await screen.findByTestId('current-plan-card');
    expect(within(card).getByText('Free')).toBeInTheDocument();
    expect(attempts).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('BillingScreen — plan picker (billing live, free tier)', () => {
  it('plan card: Free, $0, lifetime cleanup actions left, no cancel affordance', async () => {
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen();

    const card = await screen.findByTestId('current-plan-card');
    expect(within(card).getByText('Free')).toBeInTheDocument();
    expect(within(card).getByText('$0')).toBeInTheDocument();
    expect(within(card).getByText('3 of 5 lifetime cleanup actions left.')).toBeInTheDocument();
    expect(
      within(card).queryByRole('button', { name: 'Cancel subscription' }),
    ).not.toBeInTheDocument();
    // Picker marks Free as current — no CTA on the current plan.
    const freeOption = screen.getByTestId('plan-option-free');
    expect(within(freeOption).getByText('Current')).toBeInTheDocument();
    expect(within(freeOption).queryByRole('button')).not.toBeInTheDocument();
  });

  it('one-tap toggle: every price + the manifest-derived savings badge update together', async () => {
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen();

    const picker = await screen.findByTestId('plan-picker');
    // Default is annual (savings-forward), badge derived off the manifest.
    const annualButton = within(picker).getByRole('button', { name: ANNUAL_TOGGLE });
    expect(annualButton).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(screen.getByTestId('plan-option-plus')).getByText(
        new RegExp(`\\${planPriceLabel('plus', 'annual')}`),
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('plan-option-pro')).getByText(
        new RegExp(`\\${planPriceLabel('pro', 'annual')}`),
      ),
    ).toBeInTheDocument();

    // ONE interaction flips every price.
    fireEvent.click(within(picker).getByRole('button', { name: 'Monthly' }));
    expect(
      within(screen.getByTestId('plan-option-plus')).getByText(
        new RegExp(`\\${planPriceLabel('plus', 'monthly')}`),
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('plan-option-pro')).getByText(
        new RegExp(`\\${planPriceLabel('pro', 'monthly')}`),
      ),
    ).toBeInTheDocument();
  });

  it('TWO clicks to the provider: Upgrade to Pro → confirm → exact D117 contract body', async () => {
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
              provider: 'paddle',
              kind: 'overlay',
              priceId: 'pri_test_123',
              clientToken: 'test_token',
              environment: 'sandbox',
              customData: { workspace_id: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sig: 'test-sig' },
            },
          });
        },
      },
    ]);
    renderScreen();

    // Click 1 — the plan CTA opens the D226 confirm step in place.
    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    const panel = screen.getByTestId('checkout-panel');
    expect(within(panel).getByText('Preview · before anything changes')).toBeInTheDocument();
    // Defaults: annual cycle, Paddle provider, Founding Pro claimed.
    expect(within(panel).getByRole('checkbox')).toBeChecked();
    expect(within(panel).getByText(/Claim Founding Pro — \$129\/yr/)).toBeInTheDocument();
    expect(within(panel).getByText(/\$129 billed annually, starting today/)).toBeInTheDocument();
    expect(within(panel).getByText('30-day money-back guarantee')).toBeInTheDocument();

    // Click 2 — confirm into the provider surface.
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
    await waitFor(() => expect(launchCheckout).toHaveBeenCalledTimes(1));
    expect(vi.mocked(launchCheckout).mock.calls[0]?.[0]).toMatchObject({
      provider: 'paddle',
      priceId: 'pri_test_123',
      customData: { workspace_id: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sig: 'test-sig' },
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

    const picker = await screen.findByTestId('plan-picker');
    fireEvent.click(within(picker).getByRole('button', { name: 'Monthly' }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Upgrade to Pro' }));

    const panel = screen.getByTestId('checkout-panel');
    expect(within(panel).queryByText(/Founding Pro/)).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByLabelText(/UPI · cards · netbanking/));
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );

    await waitFor(() =>
      expect(checkoutBody).toEqual({ tierId: 'pro', cycle: 'monthly', provider: 'razorpay' }),
    );
  });

  it('a deep-linked intent opens the confirm step with the exact plan and cycle', async () => {
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen({ plan: 'pro', cycle: 'monthly' });

    const panel = await screen.findByTestId('checkout-panel');
    expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).queryByText(/Founding Pro/)).not.toBeInTheDocument();
  });

  it('preserves an explicit Founding Pro annual claim from pricing', async () => {
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen({ plan: 'pro', cycle: 'annual', promo: 'foundingPro' });

    const panel = await screen.findByTestId('checkout-panel');
    expect(screen.getByRole('button', { name: ANNUAL_TOGGLE })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(panel).getByRole('checkbox')).toBeChecked();
    expect(within(panel).getByText(/Claim Founding Pro — \$129\/yr/)).toBeInTheDocument();
  });

  it('Keep current plan collapses the confirm step without a request', async () => {
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));
    const panel = screen.getByTestId('checkout-panel');
    fireEvent.click(within(panel).getByRole('button', { name: 'Keep current plan' }));

    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
    expect(launchCheckout).not.toHaveBeenCalled();
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

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));
    const panel = screen.getByTestId('checkout-panel');
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );

    expect(
      await within(panel).findByText(
        'Billing isn’t switched on yet — checkout opens here once it goes live.',
      ),
    ).toBeInTheDocument();
    expect(launchCheckout).not.toHaveBeenCalled();
  });

  it('payment processing: checkout.completed shows the truthful pending state; only the polled server tier clears it', async () => {
    // The subscription read flips ONLY when "the webhook lands" — the
    // test controls that moment through this mutable body.
    let subscriptionBody: BillingSubscription = FREE_BODY;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: subscriptionBody }),
      },
      {
        method: 'POST',
        path: '/api/billing/checkout',
        respond: () =>
          jsonOk({
            data: {
              provider: 'paddle',
              kind: 'overlay',
              priceId: 'pri_test_123',
              clientToken: 'test_token',
              environment: 'sandbox',
              customData: { workspace_id: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sig: 'test-sig' },
            },
          }),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );
    await waitFor(() => expect(launchCheckout).toHaveBeenCalledTimes(1));

    // No pending state before the overlay reports payment (§10 — the
    // screen must not celebrate a checkout that merely OPENED).
    expect(screen.queryByTestId('payment-processing-notice')).not.toBeInTheDocument();

    // Overlay reports payment completed → truthful processing state; the
    // confirm panel is gone, and NO tier is claimed yet.
    act(() => capturedCheckoutEvents().onCompleted?.());
    expect(await screen.findByTestId('payment-processing-notice')).toHaveTextContent(
      'Payment received — confirming your plan.',
    );
    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('current-plan-card')).getByText('Free')).toBeInTheDocument();
    // Checkout is LOCKED while the payment awaits its webhook — a
    // second checkout here could double-charge (SUBSCRIPTION_EXISTS
    // can't catch it: the subscription row doesn't exist yet).
    expect(screen.queryByRole('button', { name: /Upgrade to/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to Free' })).not.toBeInTheDocument();

    // "Webhook lands": the server now reports pro — the immediate
    // post-completion refetch picks it up and the pending state clears.
    subscriptionBody = PRO_SUB;
    act(() => capturedCheckoutEvents().onCompleted?.());
    await waitFor(() =>
      expect(screen.queryByTestId('payment-processing-notice')).not.toBeInTheDocument(),
    );
    expect(within(screen.getByTestId('current-plan-card')).getByText('Pro')).toBeInTheDocument();
    // The lock lifts with the pending state — plan changes are
    // available again against the NEW tier.
    expect(screen.getByRole('button', { name: 'Switch to Free' })).toBeInTheDocument();
  });

  it('a poll failure while processing keeps the processing notice — never "no charge was made"', async () => {
    // After a COMPLETED payment, the full-screen error state's copy
    // would be false; a transient poll 5xx must not surface it.
    let failReads = false;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => (failReads ? jsonServerError() : jsonOk({ data: FREE_BODY })),
      },
      {
        method: 'POST',
        path: '/api/billing/checkout',
        respond: () =>
          jsonOk({
            data: {
              provider: 'paddle',
              kind: 'overlay',
              priceId: 'pri_test_123',
              clientToken: 'test_token',
              environment: 'sandbox',
              customData: { workspace_id: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sig: 'test-sig' },
            },
          }),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );
    await waitFor(() => expect(launchCheckout).toHaveBeenCalledTimes(1));

    act(() => capturedCheckoutEvents().onCompleted?.());
    await screen.findByTestId('payment-processing-notice');

    // The next poll fails — trigger it via the completed-handler's
    // immediate refetch and let the failure land.
    failReads = true;
    act(() => capturedCheckoutEvents().onCompleted?.());
    await waitFor(() => expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument());
    expect(screen.getByTestId('payment-processing-notice')).toBeInTheDocument();
    expect(screen.queryByText(/no charge or plan change was made/i)).not.toBeInTheDocument();
  });

  it('after 90s without the webhook, the notice switches to the honest slow copy and keeps checking', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: FREE_BODY }),
      },
      {
        method: 'POST',
        path: '/api/billing/checkout',
        respond: () =>
          jsonOk({
            data: {
              provider: 'paddle',
              kind: 'overlay',
              priceId: 'pri_test_123',
              clientToken: 'test_token',
              environment: 'sandbox',
              customData: { workspace_id: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sig: 'test-sig' },
            },
          }),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );
    await waitFor(() => expect(launchCheckout).toHaveBeenCalledTimes(1));

    // Fake timers ONLY from here — the slow timer registers when the
    // overlay reports completion, so it lands under our control.
    vi.useFakeTimers();
    try {
      act(() => capturedCheckoutEvents().onCompleted?.());
      expect(screen.getByTestId('payment-processing-notice')).toHaveTextContent(
        'Payment received — confirming your plan.',
      );

      act(() => vi.advanceTimersByTime(91_000));
      const notice = screen.getByTestId('payment-processing-notice');
      expect(notice).toHaveTextContent('Still confirming — this is taking longer than usual.');
      expect(notice).toHaveTextContent('support@declutrmail.com');
      // Still the truthful non-claim: the card has not flipped.
      expect(within(screen.getByTestId('current-plan-card')).getByText('Free')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('checkout 409 SUBSCRIPTION_EXISTS renders its shared inline message', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: FREE_BODY }),
      },
      {
        method: 'POST',
        path: '/api/billing/checkout',
        respond: () =>
          new Response(
            JSON.stringify({
              error: { code: 'SUBSCRIPTION_EXISTS', message: 'ignored — ERROR_CODES copy wins' },
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));
    const panel = screen.getByTestId('checkout-panel');
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );

    expect(await within(panel).findByRole('alert')).toBeInTheDocument();
    expect(launchCheckout).not.toHaveBeenCalled();
  });

  it('the pending lock survives a reload: a stored record locks a fresh mount', async () => {
    // "Reload" = a fresh mount finding the persisted record (the mock
    // me fixture's workspace id is 'w').
    writePendingCheckout('w', 'free');
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen();

    expect(await screen.findByTestId('payment-processing-notice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade to/ })).not.toBeInTheDocument();
  });

  it("another workspace's pending record does not lock this one", async () => {
    writePendingCheckout('someone-elses-workspace', 'free');
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen();

    expect(await screen.findByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument();
    expect(screen.queryByTestId('payment-processing-notice')).not.toBeInTheDocument();
  });

  it('an old unconfirmed record still LOCKS — released only by the user asserting no payment', async () => {
    // 16 minutes old: past the unconfirmed threshold. The lock must
    // NOT silently expire (that would reopen the double-charge window
    // for exactly the user whose webhook is delayed).
    window.localStorage.setItem(
      PENDING_CHECKOUT_KEY,
      JSON.stringify({
        workspaceId: 'w',
        fromTier: 'free',
        at: Date.now() - 16 * 60_000,
      }),
    );
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen();

    const notice = await screen.findByTestId('payment-processing-notice');
    expect(notice).toHaveTextContent(
      'Payment still unconfirmed — checkout is paused so you can’t be charged twice.',
    );
    expect(screen.queryByRole('button', { name: /Upgrade to/ })).not.toBeInTheDocument();

    // The explicit, user-asserted release — the only non-flip way out.
    fireEvent.click(
      within(notice).getByRole('button', { name: 'I didn’t complete a payment — resume checkout' }),
    );
    expect(screen.queryByTestId('payment-processing-notice')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument();
    expect(window.localStorage.getItem(PENDING_CHECKOUT_KEY)).toBeNull();
  });

  it('a payment completed in ANOTHER tab locks this one live (storage event)', async () => {
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen();
    expect(await screen.findByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument();

    // Another tab writes the record; the browser fires `storage` here.
    const record = writePendingCheckout('w', 'free');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: PENDING_CHECKOUT_KEY,
          newValue: JSON.stringify(record),
        }),
      );
    });

    expect(screen.getByTestId('payment-processing-notice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade to/ })).not.toBeInTheDocument();
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

  it('Switch to Free shows the D120 downgrade panel routing to cancel', async () => {
    mockTier = 'pro';
    stubSubscription(() => jsonOk({ data: PRO_SUB }));
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Free' }));
    const panel = screen.getByTestId('downgrade-panel');
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
    expect(screen.queryByTestId('downgrade-panel')).not.toBeInTheDocument();
  });

  it('selecting the other paid tier states the honest no-self-serve path', async () => {
    mockTier = 'pro';
    stubSubscription(() => jsonOk({ data: PRO_SUB }));
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));

    expect(screen.getByTestId('paid-switch-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
  });
});
