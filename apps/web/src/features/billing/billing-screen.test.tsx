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

import { focusManager } from '@tanstack/react-query';
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

import { ERROR_CODES, type BillingSubscription } from '@declutrmail/shared/contracts';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { launchCheckout, type CheckoutEvents } from './checkout';
import type { BillingIntent } from './billing-intent';
import { annualMonthsFree, quotedPlanPrice, REFUND_SETTLING_POLL_MS } from './billing-model';
import { BillingScreen } from './billing-screen';
import { pendingCheckoutKey, writePendingCheckout } from './pending-checkout';

const FREE_BODY: BillingSubscription = {
  tier: 'free',
  foundingMember: false,
  subscription: null,
  pendingCheckout: null,
};

/**
 * The state a stale FREE_BODY read is hiding: a paused subscription that
 * grants nothing (so `tier` is still free) but does block a new checkout.
 * Used to prove a conflict RECONCILES the read rather than only describing
 * itself.
 */
const PAUSED_BODY: BillingSubscription = {
  tier: 'free',
  foundingMember: false,
  pendingCheckout: null,
  subscription: {
    provider: 'razorpay',
    tier: 'plus',
    status: 'paused',
    cycle: 'monthly',
    currentPeriodEnd: '2026-08-24T18:30:00.000Z',
    cancelAtPeriodEnd: false,
    cancelSource: null,
    pauseUntil: null,
    foundingMember: false,
    scheduledChange: null,
  },
};

/**
 * What the read ACTUALLY returns during the D253 settling window, copied
 * from the first live refund (prod, 2026-08-14): a full refund ends
 * entitlement at once, so `tier` is already `free`, while the row stays
 * `active` with `cancel_at_period_end` pinned until the provider confirms.
 *
 * The pre-existing settling test stubs `FREE_BODY` — a `subscription:
 * null` read — and manufactures the 409 from the checkout endpoint. That
 * pairing cannot occur: the server only throws
 * `SUBSCRIPTION_REFUND_SETTLING` when a refund row exists, and when one
 * exists the read returns it. So that test exercised the error path over a
 * screen state production never produces, and the real screen — picker
 * locked by the row, notice reading "Cancel it if you're done with it" —
 * went uncovered until a founder hit it by hand.
 */
const REFUND_SETTLING_BODY: BillingSubscription = {
  tier: 'free',
  foundingMember: false,
  pendingCheckout: null,
  subscription: {
    provider: 'paddle',
    tier: 'plus',
    status: 'active',
    cycle: 'monthly',
    currentPeriodEnd: '2026-09-12T05:45:37.562Z',
    cancelAtPeriodEnd: true,
    cancelSource: 'refund',
    pauseUntil: null,
    foundingMember: false,
    scheduledChange: null,
  },
};

const SUB: NonNullable<BillingSubscription['subscription']> = {
  provider: 'paddle',
  tier: 'pro',
  status: 'active',
  cycle: 'monthly',
  currentPeriodEnd: '2026-07-01T12:00:00.000Z',
  cancelAtPeriodEnd: false,
  cancelSource: null,
  pauseUntil: null,
  foundingMember: false,
  scheduledChange: null,
};

const PRO_SUB: BillingSubscription = {
  tier: 'pro',
  foundingMember: false,
  subscription: SUB,
  pendingCheckout: null,
};

const PLUS_SUB: BillingSubscription = {
  tier: 'plus',
  foundingMember: false,
  pendingCheckout: null,
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
  it('plan card: Free, $0, monthly cleanup actions left, no cancel affordance', async () => {
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen();

    const card = await screen.findByTestId('current-plan-card');
    expect(within(card).getByText('Free')).toBeInTheDocument();
    expect(within(card).getByText('$0')).toBeInTheDocument();
    // "No card on file" may render ONLY with no subscription record at
    // all (a paused/ended row means the provider may hold one).
    expect(within(card).getByText(/Free forever — no card on file/)).toBeInTheDocument();
    expect(
      within(card).getByText(
        `3 of ${TIER_MANIFEST.free.cleanupActionsPerMonth} cleanup actions left this month.`,
      ),
    ).toBeInTheDocument();
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
        new RegExp(`\\${quotedPlanPrice('plus', 'annual')}`),
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('plan-option-pro')).getByText(
        new RegExp(`\\${quotedPlanPrice('pro', 'annual')}`),
      ),
    ).toBeInTheDocument();

    // ONE interaction flips every price.
    fireEvent.click(within(picker).getByRole('button', { name: 'Monthly' }));
    expect(
      within(screen.getByTestId('plan-option-plus')).getByText(
        new RegExp(`\\${quotedPlanPrice('plus', 'monthly')}`),
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('plan-option-pro')).getByText(
        new RegExp(`\\${quotedPlanPrice('pro', 'monthly')}`),
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
    // Defaults: annual cycle, Paddle provider, Founding Pro NOT claimed.
    //
    // The claim is an opt-in — its own control says "Claim" — so it must not
    // arrive pre-ticked. Pre-ticked, the quoted price and the confirm button
    // committed to a promotional point the user never chose, and Founding Pro
    // is change-LOCKED once bought (`FOUNDING_PLAN_LOCKED`). The label still
    // advertises $129 because that is what the promo costs; the CHARGE line
    // quotes the standard point the picker is actually standing on.
    expect(within(panel).getByRole('checkbox')).not.toBeChecked();
    expect(within(panel).getByText(/Claim Founding Pro — \$129\/yr/)).toBeInTheDocument();
    expect(within(panel).getByText(/\$190 billed annually, starting today/)).toBeInTheDocument();
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
      }),
    );
    await waitFor(() => expect(launchCheckout).toHaveBeenCalledTimes(1));
    expect(vi.mocked(launchCheckout).mock.calls[0]?.[0]).toMatchObject({
      provider: 'paddle',
      priceId: 'pri_test_123',
      customData: { workspace_id: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sig: 'test-sig' },
    });
  });

  // The positive half of the default-OFF change. Asserting only that the box
  // starts unchecked would pass just as well if the claim were broken outright,
  // so the opt-in has to be exercised: tick it, and the promo must reach the
  // request body and re-quote the promotional price.
  it('ticking Claim Founding Pro opts in — promo reaches the body and re-quotes', async () => {
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
              priceId: 'pri_test_founding',
              clientToken: 'test_token',
              environment: 'sandbox',
              customData: { workspace_id: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sig: 'test-sig' },
            },
          });
        },
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    const panel = screen.getByTestId('checkout-panel');
    expect(within(panel).getByText(/\$190 billed annually, starting today/)).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('checkbox'));
    expect(within(panel).getByRole('checkbox')).toBeChecked();
    // The charge line follows the claim onto the promotional point.
    expect(within(panel).getByText(/\$129 billed annually, starting today/)).toBeInTheDocument();

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

  it('monthly cycle drops the promo and still defaults to the Paddle rail (D117)', async () => {
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
              priceId: 'pri_test',
              clientToken: 'test_token',
              environment: 'sandbox',
              customData: { workspace_id: 'ws-1', sig: 'test-sig' },
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
    // Razorpay went live 2026-07-25, so Pro monthly now carries a plan id
    // and the rail IS offered. What must not change is the default: this
    // screen renders without a geo hint, so an unrouted visitor stays on
    // Paddle and is charged USD unless they pick otherwise.
    expect(within(panel).getByLabelText(/UPI · cards · netbanking/)).toBeInTheDocument();
    expect(within(panel).getByLabelText(/Card · PayPal · Apple Pay/)).toBeChecked();
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );

    await waitFor(() =>
      expect(checkoutBody).toEqual({ tierId: 'pro', cycle: 'monthly', provider: 'paddle' }),
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

  it('a failed provider WINDOW surfaces the held claim — the session already exists', async () => {
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
              clientToken: 'test_client_token',
              environment: 'sandbox',
              customData: {
                workspace_id: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff',
                sig: 'test-sig',
              },
            },
          }),
      },
    ]);
    vi.mocked(launchCheckout).mockRejectedValueOnce(new Error('script blocked'));
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));
    const panel = screen.getByTestId('checkout-panel');
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );

    // The truth CHANGED with #433: the provider SESSION exists and the
    // server claim is held (an orphaned Razorpay subscription is
    // payable from its emailed link), so the reservation SURFACES
    // instead of releasing. The banner — not a panel-local alert — is
    // the canonical surface for this state: it renders the
    // outcome-neutral intent anchor and owns the release path.
    const notice = await screen.findByTestId('payment-processing-notice');
    expect(notice).toHaveTextContent('Checkout started');
  });

  it('a failed checkout CREATE surfaces the held claim — no invisible-lock trap (Codex 2026-07-29)', async () => {
    // Post-claim ambiguous failure (BILLING_PROVIDER_ERROR): the server
    // holds the claim, so releasing locally left live CTAs beside a
    // server refusing the retry with CHECKOUT_IN_FLIGHT that named a
    // release control the user could not see.
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
              error: { code: 'BILLING_PROVIDER_ERROR', message: 'provider unreachable' },
            }),
            { status: 502, headers: { 'content-type': 'application/json' } },
          ),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));
    const panel = screen.getByTestId('checkout-panel');
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );

    const notice = await screen.findByTestId('payment-processing-notice');
    expect(notice).toHaveTextContent('Checkout started');
  });

  it('a PRE-CLAIM rejection still releases and shows only the inline message', async () => {
    // SUBSCRIPTION_EXISTS throws before the claim exists server-side —
    // surfacing a lock here would assert an in-flight checkout that
    // never was. The 409 test above pins the inline alert; this pins
    // the ABSENCE of the banner.
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
              error: { code: 'SUBSCRIPTION_EXISTS', message: 'already subscribed' },
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

    await within(panel).findByRole('alert');
    expect(screen.queryByTestId('payment-processing-notice')).not.toBeInTheDocument();
  });

  // D253 — the refund-settling refusal. A full refund ends entitlement at
  // once but leaves the row `active` until the provider confirms it settled:
  // for that window the customer holds nothing AND cannot buy. Both registry
  // decisions for the new code ride this one path.
  it('a refund-settling refusal releases the reservation, keeps its message, and does NOT refetch', async () => {
    let subscriptionReads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => {
          subscriptionReads += 1;
          return jsonOk({ data: FREE_BODY });
        },
      },
      {
        method: 'POST',
        path: '/api/billing/checkout',
        respond: () =>
          new Response(
            JSON.stringify({
              error: { code: 'SUBSCRIPTION_REFUND_SETTLING', message: 'ignored — registry wins' },
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));
    const panel = screen.getByTestId('checkout-panel');
    expect(subscriptionReads).toBe(1);
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );

    // PRE-CLAIM: the guard threw before any provider call, so surfacing a
    // payment reservation would assert a charge that cannot exist — and
    // would lock the very retry this message invites.
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      ERROR_CODES.SUBSCRIPTION_REFUND_SETTLING.message,
    );
    expect(screen.queryByTestId('payment-processing-notice')).not.toBeInTheDocument();

    // NOT a stale read (unlike its two guard siblings): "you're on Free,
    // pick a plan" is TRUE during the settling window. Refetching would
    // surface a non-backing notice for a subscription the refund already
    // ended, disable the picker, and unmount the panel carrying this
    // message — reinstating the lie the code exists to delete.
    expect(subscriptionReads).toBe(1);
    expect(
      within(panel).getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    ).toBeEnabled();
  });

  it('the settling window explains itself instead of telling you to cancel', async () => {
    // The state the previous test could not reach. Founder-observed on the
    // first live refund: the picker is locked (correct — checkout would
    // 409), but the notice read "A Plus subscription is on your account …
    // Cancel it if you're done with it", which names the wrong cause and
    // the wrong remedy, and cancel is inert because the row is already
    // scheduled.
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: REFUND_SETTLING_BODY }),
      },
    ]);
    renderScreen();

    const notice = await screen.findByTestId('non-backing-subscription-notice');
    expect(notice).toHaveTextContent('Your refund is being processed');
    expect(notice).toHaveTextContent(/subscribe again once your payment provider confirms/i);

    // The two lies, gone.
    expect(notice).not.toHaveTextContent(/Cancel it if you/i);
    expect(notice).not.toHaveTextContent(/isn.t what grants it/i);

    // No verb: resume is refused server-side (CANCELLATION_NOT_REVOCABLE)
    // and cancel is a no-op on an already-scheduled row, so offering
    // either would be a control that changes nothing.
    expect(within(notice).queryByRole('button')).toBeNull();

    // Still no purchase CTA — that part was always right, since the server
    // refuses this row's checkout until the refund settles.
    expect(screen.queryByRole('button', { name: /Upgrade to Plus/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Upgrade to Pro/i })).toBeNull();
  });

  it('the settling window polls itself back to life when the refund settles', async () => {
    // The notice promises "we'll switch this back on automatically", and
    // nothing else in the app can keep that promise: `refetchOnWindowFocus`
    // is off globally, so without a poll an open tab sits on the settling
    // state past the moment the plan became purchasable again — the screen
    // asserting a recovery it does not perform (Codex stop-review,
    // 2026-08-14).
    let body: BillingSubscription = REFUND_SETTLING_BODY;
    let reads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => {
          reads += 1;
          return jsonOk({ data: body });
        },
      },
    ]);

    // Fake timers BEFORE the render, unlike the payment-processing test
    // above: that one waits on a timer registered later, by the overlay
    // callback, while this poll's interval is created by the query observer
    // at MOUNT. Installed afterwards, the interval would already be on the
    // real clock and no amount of advancing would fire it — the failure
    // mode that made a working poll look broken while writing this.
    // `shouldAdvanceTime` keeps Testing Library's own waiting usable.
    //
    // jsdom also reports the window unfocused, and
    // `refetchIntervalInBackground` is deliberately left off, so the
    // interval is paused here for exactly the reason it pauses on a
    // backgrounded tab in production. Declaring focus is what a user
    // looking at the screen does.
    focusManager.setFocused(true);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderScreen();
      expect(await screen.findByTestId('non-backing-subscription-notice')).toHaveTextContent(
        'Your refund is being processed',
      );
      expect(reads).toBe(1);

      // The provider approves: the verdict pass flips the row terminal and
      // frees the plan slot. The screen has been told nothing.
      body = {
        ...REFUND_SETTLING_BODY,
        subscription: { ...REFUND_SETTLING_BODY.subscription!, status: 'canceled' },
      };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFUND_SETTLING_POLL_MS + 1_000);
      });
      expect(reads).toBeGreaterThan(1);

      // Recovered with no reload: the settling copy is gone and the plan is
      // purchasable again.
      await waitFor(() =>
        expect(screen.getByTestId('non-backing-subscription-notice')).toHaveTextContent(
          /subscription ended/i,
        ),
      );
      expect(screen.getByRole('button', { name: /Upgrade to Plus/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      focusManager.setFocused(undefined);
    }
  });

  it('a settled subscription is NOT polled — the poll is scoped to the wait', async () => {
    // Guards the blind case: a poll that never turns off would bill every
    // idle billing tab a read a minute, forever.
    let reads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => {
          reads += 1;
          return jsonOk({ data: FREE_BODY });
        },
      },
    ]);
    // Focused and faked the same way as the test above, so a poll that
    // wrongly stayed on WOULD be observed here — the blind case this
    // guards is a timer that never turns off.
    focusManager.setFocused(true);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderScreen();
      await screen.findByRole('button', { name: /Upgrade to Plus/i });
      expect(reads).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFUND_SETTLING_POLL_MS * 3);
      });
      expect(reads).toBe(1);
    } finally {
      vi.useRealTimers();
      focusManager.setFocused(undefined);
    }
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
    // The checkout_intent reservation transitioned to the id-less
    // `checkout` lock (own-id overwrite).
    expect(
      (JSON.parse(window.localStorage.getItem(pendingCheckoutKey('w'))!) as { kind: string }).kind,
    ).toBe('checkout');
    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('current-plan-card')).getByText('Free')).toBeInTheDocument();
    // Checkout is LOCKED while the payment awaits its webhook — a
    // second checkout here could double-charge (SUBSCRIPTION_EXISTS
    // can't catch it: the subscription row doesn't exist yet).
    expect(screen.queryByRole('button', { name: /Upgrade to/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to Free' })).not.toBeInTheDocument();

    // "Webhook lands": the server now reports pro — the immediate
    // post-completion refetch picks it up and the pending state clears.
    subscriptionBody = {
      ...PRO_SUB,
      subscription: PRO_SUB.subscription ? { ...PRO_SUB.subscription, cycle: 'annual' } : null,
    };
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

  // The stranding this closes: the cached read says Free, the server says a
  // subscription exists, and the error message names no remedy (deliberately —
  // it cannot know which remedies this rail allows). Without a refetch the
  // screen keeps inviting an upgrade the server has already refused, and no
  // control on it can resolve the disagreement. So the conflict must RECONCILE
  // the read, not just describe itself.
  it('a checkout conflict refetches billing state so the real plan and its controls appear', async () => {
    let subscriptionReads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => {
          subscriptionReads += 1;
          // First read is the stale one the screen mounted with; afterwards
          // the truth the server has been refusing against.
          return jsonOk({ data: subscriptionReads === 1 ? FREE_BODY : PAUSED_BODY });
        },
      },
      {
        method: 'POST',
        path: '/api/billing/checkout',
        respond: () =>
          new Response(
            JSON.stringify({ error: { code: 'SUBSCRIPTION_PAUSED_BLOCKS_NEW', message: 'x' } }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));
    const panel = screen.getByTestId('checkout-panel');
    expect(subscriptionReads).toBe(1);

    fireEvent.click(
      within(panel).getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );

    // The refetch is the fix; the message alone would leave the user stuck.
    await waitFor(() => expect(subscriptionReads).toBeGreaterThan(1));
    // And the reconciled state brings a real control with it.
    expect(await screen.findByRole('button', { name: /Cancel subscription/i })).toBeInTheDocument();
  });

  it('the pending lock survives a reload: a stored record locks a fresh mount', async () => {
    // "Reload" = a fresh mount finding the persisted record (the mock
    // me fixture's workspace id is 'w').
    writePendingCheckout('w', 'checkout', 'free', null, 'plus', 'monthly');
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen();

    expect(await screen.findByTestId('payment-processing-notice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade to/ })).not.toBeInTheDocument();
  });

  it("another workspace's pending record does not lock this one", async () => {
    writePendingCheckout('someone-elses-workspace', 'checkout', 'free', null, 'plus', 'monthly');
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen();

    expect(await screen.findByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument();
    expect(screen.queryByTestId('payment-processing-notice')).not.toBeInTheDocument();
    expect(
      window.localStorage.getItem(pendingCheckoutKey('someone-elses-workspace')),
    ).not.toBeNull();
  });

  it('an old unconfirmed record still LOCKS — released only by the user confirming no charge', async () => {
    // 16 minutes old: past the unconfirmed threshold. The lock must
    // NOT silently expire (that would reopen the double-charge window
    // for exactly the user whose webhook is delayed).
    window.localStorage.setItem(
      pendingCheckoutKey('w'),
      JSON.stringify({
        workspaceId: 'w',
        kind: 'checkout',
        fromTier: 'free',
        fromCycle: null,
        toTier: 'plus',
        toCycle: 'monthly',
        at: Date.now() - 16 * 60_000,
      }),
    );
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen();

    const notice = await screen.findByTestId('payment-processing-notice');
    // D249 copy truth: a first purchase awaits a PLAN UPGRADE — the old
    // string claimed a "plan change" that never existed.
    expect(notice).toHaveTextContent(
      'Payment received — your plan upgrade hasn’t come through yet.',
    );
    expect(screen.queryByRole('button', { name: /Upgrade to/ })).not.toBeInTheDocument();

    // D249: the release renders only after a provider check actually
    // ran. The reconcile route is UNSTUBBED here (599), so the check
    // lands in the honest "couldn't reach the provider" fallback — the
    // one non-verified state that still legitimizes a manual release.
    await within(notice).findByTestId('provider-check');
    expect(within(notice).getByTestId('provider-check')).toHaveTextContent(
      'We couldn’t reach the payment provider to check automatically.',
    );

    // The explicit, user-asserted release — the only non-flip way out —
    // is TWO-step: the first click states the double-charge risk and
    // releases nothing yet.
    fireEvent.click(
      await within(notice).findByRole('button', {
        name: 'No charge went through — resume checkout',
      }),
    );
    const releaseConfirm = within(notice).getByTestId('release-confirm');
    expect(releaseConfirm).toHaveTextContent(/you could be charged twice/i);
    expect(screen.getByTestId('payment-processing-notice')).toBeInTheDocument();
    expect(window.localStorage.getItem(pendingCheckoutKey('w'))).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Upgrade to/ })).not.toBeInTheDocument();

    // "Keep waiting" backs out without releasing anything.
    fireEvent.click(within(releaseConfirm).getByRole('button', { name: 'Keep waiting' }));
    expect(within(notice).queryByTestId('release-confirm')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(pendingCheckoutKey('w'))).not.toBeNull();

    // Only the confirmed assertion releases the lock.
    fireEvent.click(
      within(notice).getByRole('button', { name: 'No charge went through — resume checkout' }),
    );
    fireEvent.click(
      within(notice).getByRole('button', { name: 'I checked — no charge. Resume checkout' }),
    );
    expect(screen.queryByTestId('payment-processing-notice')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument();
    expect(window.localStorage.getItem(pendingCheckoutKey('w'))).toBeNull();
  });

  it('D249: the release stays hidden until the provider check comes back empty', async () => {
    window.localStorage.setItem(
      pendingCheckoutKey('w'),
      JSON.stringify({
        workspaceId: 'w',
        kind: 'checkout',
        fromTier: 'free',
        fromCycle: null,
        toTier: 'plus',
        toCycle: 'monthly',
        at: Date.now() - 16 * 60_000,
      }),
    );
    // Reconcile answers slowly with a VERIFIED empty result — the gate
    // this test pins: no release while checking, server-verified copy
    // (not "I checked") once the provider answered.
    let resolveReconcile: (r: Response) => void = () => undefined;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: FREE_BODY }),
      },
      {
        method: 'POST',
        path: '/api/billing/reconcile',
        respond: () => new Promise<Response>((resolve) => (resolveReconcile = resolve)),
      },
    ]);
    renderScreen();

    const notice = await screen.findByTestId('payment-processing-notice');
    await within(notice).findByTestId('provider-check');
    expect(within(notice).getByTestId('provider-check')).toHaveTextContent(
      'Checking with the payment provider…',
    );
    // While the server is asking the provider, the customer is NOT
    // asked to guess — no release affordance exists yet.
    expect(within(notice).queryByRole('button', { name: /resume checkout/i })).toBeNull();

    resolveReconcile(jsonOk({ data: { outcome: 'none_found' } }));
    await within(notice).findByRole('button', { name: 'No payment found — resume checkout' });
    expect(within(notice).getByTestId('provider-check')).toHaveTextContent(
      'We checked with the payment provider — no completed payment found for this checkout.',
    );
    // Re-check affordance rides along; the two-step confirm still
    // guards the release itself (3DS can settle after any search).
    expect(within(notice).getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });

  it('D249: a granted provider check reports the found payment and never offers a release', async () => {
    window.localStorage.setItem(
      pendingCheckoutKey('w'),
      JSON.stringify({
        workspaceId: 'w',
        kind: 'checkout',
        fromTier: 'free',
        fromCycle: null,
        toTier: 'plus',
        toCycle: 'monthly',
        at: Date.now() - 16 * 60_000,
      }),
    );
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: FREE_BODY }),
      },
      {
        method: 'POST',
        path: '/api/billing/reconcile',
        respond: () => jsonOk({ data: { outcome: 'granted' } }),
      },
    ]);
    renderScreen();

    const notice = await screen.findByTestId('payment-processing-notice');
    await waitFor(() =>
      expect(within(notice).getByTestId('provider-check')).toHaveTextContent(
        'Found your payment — your plan is updating now.',
      ),
    );
    // Truth is written server-side; asking the customer to assert "no
    // charge" now would invite releasing a PAID checkout.
    expect(within(notice).queryByRole('button', { name: /resume checkout/i })).toBeNull();
  });

  it('D249: payment_in_progress keeps the release LOCKED — a 3DS-window resume is the double charge', async () => {
    window.localStorage.setItem(
      pendingCheckoutKey('w'),
      JSON.stringify({
        workspaceId: 'w',
        kind: 'checkout',
        fromTier: 'free',
        fromCycle: null,
        toTier: 'plus',
        toCycle: 'monthly',
        at: Date.now() - 16 * 60_000,
      }),
    );
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: FREE_BODY }),
      },
      {
        method: 'POST',
        path: '/api/billing/reconcile',
        respond: () => jsonOk({ data: { outcome: 'payment_in_progress' } }),
      },
    ]);
    renderScreen();

    const notice = await screen.findByTestId('payment-processing-notice');
    await waitFor(() =>
      expect(within(notice).getByTestId('provider-check')).toHaveTextContent('still in progress'),
    );
    expect(within(notice).queryByRole('button', { name: /resume checkout/i })).toBeNull();
    // Re-check stays available — in-progress resolves on its own.
    expect(within(notice).getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });

  it('D249: no_pending states that NOTHING is in flight — never "found your payment"', async () => {
    // The stale-lock regression (Codex 2026-07-30): claim TTL'd and
    // swept, local lock alive. The old else-branch rendered no_pending
    // as "Found your payment" — a lie with the release locked forever.
    window.localStorage.setItem(
      pendingCheckoutKey('w'),
      JSON.stringify({
        workspaceId: 'w',
        kind: 'checkout',
        fromTier: 'free',
        fromCycle: null,
        toTier: 'plus',
        toCycle: 'monthly',
        at: Date.now() - 40 * 60_000,
      }),
    );
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: FREE_BODY }),
      },
      {
        method: 'POST',
        path: '/api/billing/reconcile',
        respond: () => jsonOk({ data: { outcome: 'no_pending' } }),
      },
    ]);
    renderScreen();

    const notice = await screen.findByTestId('payment-processing-notice');
    await waitFor(() =>
      expect(within(notice).getByTestId('provider-check')).toHaveTextContent(
        'Nothing is awaiting confirmation for this checkout',
      ),
    );
    expect(within(notice).getByTestId('provider-check')).not.toHaveTextContent(
      /found your payment/i,
    );
    // Nothing in flight anywhere → the way out is available.
    expect(
      within(notice).getByRole('button', { name: 'Nothing in flight — resume checkout' }),
    ).toBeInTheDocument();
  });

  it('D249: a stuck plan change reconciles via kind=change and reports change wording', async () => {
    // An immediate upgrade leaves no checkout claim — the change wait
    // must ask about the workspace's LIVE subscriptions, not the
    // checkout ladder (which would answer "no payment found" about an
    // upgrade that DID charge).
    window.localStorage.setItem(
      pendingCheckoutKey('w'),
      JSON.stringify({
        workspaceId: 'w',
        kind: 'change',
        fromTier: 'plus',
        fromCycle: 'monthly',
        toTier: 'pro',
        toCycle: 'annual',
        at: Date.now() - 16 * 60_000,
      }),
    );
    let reconcileBody: unknown = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PLUS_SUB }),
      },
      {
        method: 'POST',
        path: '/api/billing/reconcile',
        respond: async (req) => {
          reconcileBody = await req.json();
          return jsonOk({ data: { outcome: 'already_recorded' } });
        },
      },
    ]);
    renderScreen();

    const notice = await screen.findByTestId('payment-processing-notice');
    await waitFor(() =>
      expect(within(notice).getByTestId('provider-check')).toHaveTextContent(
        'Confirmed with the payment provider — your plan is updating now.',
      ),
    );
    // The change wait must never claim a checkout fact in either
    // direction — no "payment found", no "no payment found".
    expect(within(notice).getByTestId('provider-check')).not.toHaveTextContent(/payment found/i);
    // The awaited target rides along — the server splits "unchanged"
    // into confirmed vs never-happened on it.
    expect(reconcileBody).toMatchObject({ kind: 'change', toTier: 'pro', cycle: 'annual' });
  });

  it('D249: a change the provider never received says so and offers retry — never "Confirmed"', async () => {
    window.localStorage.setItem(
      pendingCheckoutKey('w'),
      JSON.stringify({
        workspaceId: 'w',
        kind: 'change',
        fromTier: 'plus',
        fromCycle: 'monthly',
        toTier: 'pro',
        toCycle: 'annual',
        at: Date.now() - 16 * 60_000,
      }),
    );
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PLUS_SUB }),
      },
      {
        method: 'POST',
        path: '/api/billing/reconcile',
        respond: () => jsonOk({ data: { outcome: 'none_found' } }),
      },
    ]);
    renderScreen();

    const notice = await screen.findByTestId('payment-processing-notice');
    await waitFor(() =>
      expect(within(notice).getByTestId('provider-check')).toHaveTextContent(
        'your plan change hasn’t gone through',
      ),
    );
    // The false confirmation Codex caught — and the checkout wording —
    // must both be absent.
    expect(within(notice).getByTestId('provider-check')).not.toHaveTextContent(/Confirmed/);
    expect(within(notice).getByTestId('provider-check')).not.toHaveTextContent(/payment found/i);
    // Provider-verified absence unlocks the single-click change release
    // without the 15-minute timer.
    expect(
      within(notice).getByRole('button', { name: 'Stop waiting — let me try again' }),
    ).toBeInTheDocument();
  });

  it('a completing checkout never clobbers a surfaced (id-less) ambiguous change lock', async () => {
    // The surfaced/interrupted change_unconfirmed record carries no
    // attemptId — it is absolutely protected: even a checkout that just
    // completed its overlay payment must surface it, not replace it.
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

    // Another tab's ambiguous change surfaces its lock while the
    // overlay is open here (pre-storage-event race — no event fired).
    window.localStorage.setItem(
      pendingCheckoutKey('w'),
      JSON.stringify({
        workspaceId: 'w',
        kind: 'change_unconfirmed',
        fromTier: 'plus',
        fromCycle: 'monthly',
        toTier: 'pro',
        toCycle: 'annual',
        at: Date.now(),
      }),
    );

    act(() => capturedCheckoutEvents().onCompleted?.());

    // The ambiguous lock survives verbatim and is what the screen shows.
    const notice = await screen.findByTestId('payment-processing-notice');
    expect(notice).toHaveTextContent('Plan change unconfirmed');
    expect(notice).not.toHaveTextContent('Payment received');
    const after = JSON.parse(window.localStorage.getItem(pendingCheckoutKey('w'))!) as {
      kind: string;
      attemptId?: string;
    };
    expect(after.kind).toBe('change_unconfirmed');
    expect(after.attemptId).toBeUndefined();
  });

  it('a fresh checkout RESERVES the slot before the overlay; duplicates stand down; close releases', async () => {
    let checkoutPosts = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: FREE_BODY }),
      },
      {
        method: 'POST',
        path: '/api/billing/checkout',
        respond: () => {
          checkoutPosts += 1;
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

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );
    await waitFor(() => expect(launchCheckout).toHaveBeenCalledTimes(1));

    // The reservation exists BEFORE any payment happened — with an id.
    const reserved = JSON.parse(window.localStorage.getItem(pendingCheckoutKey('w'))!) as {
      kind: string;
      attemptId?: string;
    };
    expect(reserved.kind).toBe('checkout_intent');
    expect(typeof reserved.attemptId).toBe('string');

    // A second confirm (this or any tab) finds the reservation and
    // stands down: exactly ONE session was ever created.
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );
    expect(await screen.findByTestId('payment-processing-notice')).toHaveTextContent(
      'Checkout started',
    );
    expect(checkoutPosts).toBe(1);
    expect(launchCheckout).toHaveBeenCalledTimes(1);

    // Overlay dismissed WITHOUT a completed event: not proof of no
    // payment — the reservation SURFACES (kept + polling), never a
    // silent unlock.
    act(() => capturedCheckoutEvents().onClosed?.());
    const notice = await screen.findByTestId('payment-processing-notice');
    expect(notice).toHaveTextContent('Checkout started');
    expect(
      (JSON.parse(window.localStorage.getItem(pendingCheckoutKey('w'))!) as { kind: string }).kind,
    ).toBe('checkout_intent');

    // Re-arming is the user's explicit two-step no-charge assertion —
    // available immediately for a surfaced reservation.
    fireEvent.click(
      within(notice).getByRole('button', { name: 'No charge went through — resume checkout' }),
    );
    fireEvent.click(
      within(notice).getByRole('button', { name: 'I checked — no charge. Resume checkout' }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('payment-processing-notice')).not.toBeInTheDocument(),
    );
    expect(window.localStorage.getItem(pendingCheckoutKey('w'))).toBeNull();
    expect(await screen.findByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument();
  });

  it('a checkout confirm STANDS DOWN when a lock raced ahead of the storage event', async () => {
    // The record lands in storage but no event fires (same-tab write
    // timing / pre-processing race) — React still shows an armed
    // confirm. The fire-time storage re-read must refuse to open the
    // payment surface.
    let checkoutPosts = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: FREE_BODY }),
      },
      {
        method: 'POST',
        path: '/api/billing/checkout',
        respond: () => {
          checkoutPosts += 1;
          return jsonOk({ data: {} });
        },
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
    // Lock lands silently — no storage event reaches this tab.
    window.localStorage.setItem(
      pendingCheckoutKey('w'),
      JSON.stringify({
        workspaceId: 'w',
        kind: 'change_unconfirmed',
        fromTier: 'plus',
        fromCycle: 'monthly',
        toTier: 'pro',
        toCycle: 'annual',
        at: Date.now(),
      }),
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm — continue to secure checkout →' }),
    );

    expect(await screen.findByTestId('payment-processing-notice')).toHaveTextContent(
      'Plan change unconfirmed',
    );
    expect(checkoutPosts).toBe(0);
    expect(launchCheckout).not.toHaveBeenCalled();
    const record = JSON.parse(window.localStorage.getItem(pendingCheckoutKey('w'))!) as {
      kind: string;
    };
    expect(record.kind).toBe('change_unconfirmed');
  });

  it('a payment completed in ANOTHER tab locks this one live (storage event)', async () => {
    stubSubscription(() => jsonOk({ data: FREE_BODY }));
    renderScreen();
    expect(await screen.findByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument();

    // Another tab writes the record; the browser fires `storage` here.
    const record = writePendingCheckout('w', 'checkout', 'free', null, 'plus', 'monthly');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: pendingCheckoutKey('w'),
          newValue: JSON.stringify(record),
        }),
      );
    });

    expect(screen.getByTestId('payment-processing-notice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade to/ })).not.toBeInTheDocument();
  });
});

describe('BillingScreen — paid subscriber', () => {
  it('plan card: tier, price, renewal, cancel affordance — and NO provider name', async () => {
    mockTier = 'pro';
    mockCleanupRemaining = null;
    stubSubscription(() => jsonOk({ data: PRO_SUB }));
    renderScreen();

    const card = await screen.findByTestId('current-plan-card');
    expect(within(card).getByText('Pro')).toBeInTheDocument();
    expect(within(card).getByText('$19/mo')).toBeInTheDocument();
    expect(within(card).getByText('· Next renewal Jul 1, 2026')).toBeInTheDocument();
    // The provider is plumbing, not plan facts — never on the card.
    expect(within(card).queryByText(/via Paddle/)).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Cancel subscription' })).toBeInTheDocument();
  });

  it('founding member: banner with the locked manifest price', async () => {
    mockTier = 'pro';
    stubSubscription(() =>
      jsonOk({
        data: {
          ...PRO_SUB,
          foundingMember: true,
          pendingCheckout: null,
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
    // The guarantee is NOT named here (founder, 2026-07-31): stating it at
    // the moment of highest churn intent reads as an invitation to claim
    // it. It stays public on /refunds and in the Plan & billing header,
    // so nothing is hidden — this screen just stops advertising it.
    expect(within(modal).queryByText(/Charged in the last 30 days\?/)).toBeNull();
    expect(within(modal).queryByText(/money-back guarantee/)).toBeNull();
    expect(within(modal).queryByRole('link', { name: 'Refund Policy' })).toBeNull();
    expect(within(modal).queryByRole('link', { name: /Request a refund/ })).toBeNull();

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

  // Founder screenshot 2026-07-31: on Pro ANNUAL with a downgrade booked,
  // the card read "Pro · $190/yr · Next renewal Jul 30, 2027" — but what
  // happens that day is Plus MONTHLY at $9. The line claims this plan at
  // this price renews then, which a scheduled change makes false.
  it('current-plan card drops "Next renewal" while a plan change is scheduled', async () => {
    mockTier = 'pro';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () =>
          jsonOk({
            data: {
              ...PRO_SUB,
              subscription: {
                ...SUB,
                cycle: 'annual',
                scheduledChange: {
                  tier: 'plus',
                  cycle: 'monthly',
                  effectiveAt: '2027-07-30T18:00:00.000Z',
                  state: 'scheduled',
                },
              },
            },
          }),
      },
    ]);
    renderScreen();

    const card = await screen.findByTestId('current-plan-card');
    expect(within(card).queryByText(/Next renewal/)).toBeNull();
    // The notice below still states what actually happens.
    expect(await screen.findByText(/Downgrade scheduled/)).toBeInTheDocument();
  });

  // Same screenshot: the strip toggled to Monthly badged "Pro $19/mo"
  // CURRENT while the subscriber pays $190/yr. The badge marks the plan
  // you are ON — tier AND cycle — not whichever cycle the toggle shows.
  it('CURRENT badge does not follow the cycle toggle away from the real plan', async () => {
    mockTier = 'pro';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: { ...PRO_SUB, subscription: { ...SUB, cycle: 'annual' } } }),
      },
    ]);
    renderScreen();

    // Annual is the default; the Pro card is genuinely current there.
    await screen.findByTestId('current-plan-card');
    expect(screen.getByText('Current')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));

    // Now every card on screen is a switch target, so nothing is CURRENT.
    await waitFor(() => expect(screen.queryByText('Current')).toBeNull());
    // Screen readers must hear the same thing sighted users see — the
    // badge and `aria-current` were driven by different flags, so the
    // monthly card still announced itself as current (Codex, 2026-07-31).
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
    expect(screen.getByText(/Switch to monthly billing/)).toBeInTheDocument();
  });

  // Codex stop-review 2026-07-31: the first cut of the cycle-aware badge
  // exempted non-Paddle on the grounds the cycle was "unknowable". It is
  // not — `cycle` is on the record for every provider — so a Razorpay
  // subscriber kept seeing the exact lie the fix removed for Paddle.
  it('CURRENT badge is cycle-aware on Razorpay too, without offering a switch', async () => {
    mockTier = 'plus';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () =>
          jsonOk({
            data: {
              tier: 'plus',
              foundingMember: false,
              pendingCheckout: null,
              subscription: { ...SUB, provider: 'razorpay', tier: 'plus', cycle: 'annual' },
            },
          }),
      },
    ]);
    renderScreen();

    await screen.findByTestId('current-plan-card');
    expect(screen.getByText('Current')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));

    await waitFor(() => expect(screen.queryByText('Current')).toBeNull());
    // The badge is a FACT (cycle is known); the switch CTA is an
    // AFFORDANCE Razorpay does not support. Separate props, separate
    // answers — the CTA must stay absent.
    expect(screen.queryByText(/Switch to monthly billing/)).toBeNull();
  });

  // D118 — the way back out of a cancel. Before this, cancelling was a
  // one-way door for up to a year: `resume` only un-pauses, checkout
  // answers SUBSCRIPTION_EXISTS and change-plan answers
  // SUBSCRIPTION_CANCELING (matrix E3, verified on the sandbox
  // subscription 2026-07-31).
  it('un-cancel is NOT offered on a refunded plan — the API would 409 it', async () => {
    // A refund/chargeback reaches `cancel_scheduled` too (the projector
    // pins the flag under a local verdict), but `resume-cancellation`
    // refuses those rows with CANCELLATION_NOT_REVOCABLE. Rendering the
    // button anyway would be an undo whose only possible answer is an
    // error — the same assert-what-we-don't-know defect the pause offer
    // already guards against.
    mockTier = 'pro';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () =>
          jsonOk({
            data: {
              ...PRO_SUB,
              subscription: { ...SUB, cancelAtPeriodEnd: true, cancelSource: 'refund' },
            },
          }),
      },
    ]);
    renderScreen();

    expect(await screen.findByText(/This plan ended after a refund/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep my subscription' })).not.toBeInTheDocument();
  });

  it('un-cancel: two-step confirm restores a scheduled cancellation', async () => {
    mockTier = 'pro';
    let posted = 0;
    const scheduled: BillingSubscription = {
      ...PRO_SUB,
      subscription: { ...SUB, cancelAtPeriodEnd: true },
    };
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: scheduled }),
      },
      {
        method: 'POST',
        path: '/api/billing/resume-cancellation',
        respond: () => {
          posted += 1;
          return jsonOk({ data: PRO_SUB });
        },
      },
    ]);
    renderScreen();

    // Step 1 — the button only ARMS the confirm; nothing is sent yet.
    fireEvent.click(await screen.findByRole('button', { name: 'Keep my subscription' }));
    const confirm = screen.getByTestId('keep-subscription-confirm');
    expect(within(confirm).getByText(/\$0 today\./)).toBeInTheDocument();
    expect(within(confirm).getByText(/next charge Jul 1, 2026/)).toBeInTheDocument();
    expect(posted).toBe(0);

    // Step 2 — confirm sends it, and the cache write-back clears the notice.
    fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, keep my subscription' }));
    await waitFor(() => expect(posted).toBe(1));
    await waitFor(() =>
      expect(screen.queryByText(/Cancellation scheduled/)).not.toBeInTheDocument(),
    );
    expect(await screen.findByRole('button', { name: 'Cancel subscription' })).toBeInTheDocument();
  });

  it('un-cancel: "Never mind" disarms without sending anything', async () => {
    mockTier = 'pro';
    let posted = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () =>
          jsonOk({ data: { ...PRO_SUB, subscription: { ...SUB, cancelAtPeriodEnd: true } } }),
      },
      {
        method: 'POST',
        path: '/api/billing/resume-cancellation',
        respond: () => {
          posted += 1;
          return jsonOk({ data: PRO_SUB });
        },
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Keep my subscription' }));
    fireEvent.click(
      within(screen.getByTestId('keep-subscription-confirm')).getByRole('button', {
        name: 'Never mind',
      }),
    );

    expect(screen.queryByTestId('keep-subscription-confirm')).not.toBeInTheDocument();
    expect(posted).toBe(0);
  });

  // D118's pause-30-days offer, which shipped as nothing until now.
  it('pause offer: renders in the cancel modal and posts to /api/billing/pause', async () => {
    mockTier = 'pro';
    let posted = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PRO_SUB }),
      },
      {
        method: 'POST',
        path: '/api/billing/pause',
        respond: () => {
          posted += 1;
          return jsonOk({ data: PRO_SUB });
        },
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }));
    const offer = within(screen.getByTestId('cancel-modal')).getByTestId('pause-offer');
    expect(within(offer).getByText(/Pause instead\?/)).toBeInTheDocument();

    fireEvent.click(within(offer).getByRole('button', { name: 'Pause for 30 days' }));
    await waitFor(() => expect(posted).toBe(1));
    // The modal closes on success; the paused STATE arrives by webhook,
    // so nothing here claims the subscription is already paused.
    await waitFor(() => expect(screen.queryByTestId('cancel-modal')).not.toBeInTheDocument());
  });

  // Offering a control the API would refuse is the assert-what-we-don't-
  // know defect; the modal's guard mirrors the service's exactly.
  it('pause offer: hidden for Razorpay, which has no pause primitive', async () => {
    mockTier = 'plus';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () =>
          jsonOk({
            data: {
              tier: 'plus',
              foundingMember: false,
              pendingCheckout: null,
              subscription: { ...SUB, provider: 'razorpay', tier: 'plus' },
            },
          }),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }));
    expect(within(screen.getByTestId('cancel-modal')).queryByTestId('pause-offer')).toBeNull();
  });

  it('cancel modal stays silent on the guarantee for a PLUS subscriber too', async () => {
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
    // Silent about the guarantee for Plus exactly as for Pro — the rule is
    // tier-agnostic in both directions. What survives is the FACT that
    // canceling is not itself a refund, which is not a denial of the
    // policy, so the 2026-07-08 contradiction with the public 30-day
    // promise does not come back.
    expect(within(modal).queryByText(/money-back guarantee/)).toBeNull();
    expect(within(modal).queryByRole('link', { name: 'Refund Policy' })).toBeNull();
    expect(within(modal).getByText(/on its own it isn.t\s+a refund/i)).toBeInTheDocument();
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
    // Downgrade copy routes to the cancel step; the guarantee is named
    // there, on its own terms, rather than promised here.
    // rather than the old misleading "No refund for unused time" line.
    expect(within(panel).getByText(/the next step covers cancellation\./)).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Continue to cancellation →' }));
    expect(screen.getByTestId('cancel-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('downgrade-panel')).not.toBeInTheDocument();
  });

  it('paid→paid switch: D226 preview → POST /billing/change-plan with the exact body', async () => {
    mockTier = 'plus';
    let changeBody: unknown = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PLUS_SUB }),
      },
      {
        method: 'POST',
        path: '/api/billing/change-plan',
        respond: async (req) => {
          changeBody = await req.json();
          return jsonOk({ data: PLUS_SUB }); // pre-change state (§10)
        },
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro' }));
    const panel = screen.getByTestId('change-plan-panel');
    expect(within(panel).getByText('Preview · before anything changes')).toBeInTheDocument();
    expect(within(panel).getByText(/Plus \(monthly\) → Pro \(annual\)/)).toBeInTheDocument();
    expect(within(panel).getByText(/existing payment method/i)).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Confirm upgrade' }));
    await waitFor(() => expect(changeBody).toEqual({ tierId: 'pro', cycle: 'annual' }));

    // The change is pending until the webhook lands: truthful banner,
    // no optimistic tier, checkout locked.
    expect(await screen.findByTestId('payment-processing-notice')).toHaveTextContent(
      'Plan change accepted — confirming your plan.',
    );
    expect(within(screen.getByTestId('current-plan-card')).getByText('Plus')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch to/ })).not.toBeInTheDocument();
  });

  it('upgrade panel states the exact prorated charge from the provider preview', async () => {
    mockTier = 'plus';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PLUS_SUB }),
      },
      {
        method: 'POST',
        path: '/api/billing/change-plan/preview',
        respond: () =>
          jsonOk({
            data: {
              kind: 'immediate',
              result: { action: 'charge', amount: '18101', currencyCode: 'USD' },
              nextBilledAt: '2027-07-30T18:00:27.060Z',
            },
          }),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro' }));
    const panel = screen.getByTestId('change-plan-panel');
    // Immediate effect stated up front — the old copy read as deferred
    // ("applies after your payment provider confirms it").
    expect(await within(panel).findByText('Effective immediately.')).toBeInTheDocument();
    // The provider's own number, lowest-denomination → formatted; the
    // date is the post-change renewal from the same preview. Text is
    // split across inline nodes, so assert on the panel's textContent.
    await waitFor(() => expect(panel).toHaveTextContent('$181.01 is charged now'));
    expect(panel).toHaveTextContent('from Jul 30, 2027.');
    // Money moves today, so the guarantee is reassurance and belongs here
    // — unlike the $0 downgrade branch, where it contradicts.
    expect(panel).toHaveTextContent('30-day money-back guarantee');
  });

  it('upgrade panel falls back to generic mechanics when the preview fails — never an invented number', async () => {
    mockTier = 'plus';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PLUS_SUB }),
      },
      // No /change-plan/preview handler — the stub 599s it (a failed
      // preview must degrade to copy, not block or fabricate).
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro' }));
    const panel = screen.getByTestId('change-plan-panel');
    expect(await within(panel).findByText('Effective immediately.')).toBeInTheDocument();
    expect(panel).toHaveTextContent('The prorated difference for the rest of this period');
    // No quoted amount without provider truth — the mechanics sentence
    // stays numberless (the header's $190/yr is a list price, not a
    // proration claim).
    expect(panel).not.toHaveTextContent(/\$\d+(\.\d+)? is charged now/);
  });

  it('Pro→Plus schedules the downgrade without a charge or a weeks-long processing lock', async () => {
    mockTier = 'pro';
    const scheduled: BillingSubscription = {
      ...PRO_SUB,
      subscription: PRO_SUB.subscription
        ? {
            ...PRO_SUB.subscription,
            scheduledChange: {
              tier: 'plus',
              cycle: 'annual',
              effectiveAt: SUB.currentPeriodEnd!,
              state: 'scheduled',
            },
          }
        : null,
    };
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PRO_SUB }),
      },
      {
        method: 'POST',
        path: '/api/billing/change-plan',
        respond: async (req) => {
          const body = (await req.json()) as { tierId?: string; cycle?: string };
          return jsonOk({
            data: body.tierId === 'pro' && body.cycle === 'monthly' ? PRO_SUB : scheduled,
          });
        },
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Plus' }));
    const panel = screen.getByTestId('change-plan-panel');
    expect(panel).toHaveTextContent('$0 today');
    expect(panel).toHaveTextContent('no refund or credit');
    // …and therefore NOT the money-back line, which read as a flat
    // contradiction of the sentence right above it (founder, 2026-07-30).
    // It belongs on the branch where money moves today.
    expect(panel).not.toHaveTextContent('30-day money-back guarantee');
    fireEvent.click(within(panel).getByRole('button', { name: 'Schedule downgrade' }));

    const notice = await screen.findByTestId('scheduled-plan-change-notice');
    expect(notice).toHaveTextContent('Downgrade scheduled for Jul 1, 2026');
    expect(notice).toHaveTextContent('Pro features stay active');
    expect(screen.queryByTestId('payment-processing-notice')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('current-plan-card')).getByText('Pro')).toBeInTheDocument();

    fireEvent.click(within(notice).getByRole('button', { name: 'Keep current plan instead' }));
    await waitFor(() =>
      expect(screen.queryByTestId('scheduled-plan-change-notice')).not.toBeInTheDocument(),
    );
    expect(within(screen.getByTestId('current-plan-card')).getByText('Pro')).toBeInTheDocument();
  });

  it('an ambiguous provider error on an IMMEDIATE upgrade enters the lock+poll — no armed retry', async () => {
    // A 502 on prorated_immediately is ambiguous — the charge may have
    // landed before the response was lost. The panel must NOT stay open
    // with a retryable confirm; the screen locks, polls, and completes
    // normally if the upgrade turns out to have applied.
    mockTier = 'plus';
    let changeAttempts = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PLUS_SUB }),
      },
      {
        method: 'POST',
        path: '/api/billing/change-plan',
        respond: () => {
          changeAttempts += 1;
          return new Response(
            JSON.stringify({ error: { code: 'BILLING_PROVIDER_ERROR', message: 'ignored' } }),
            { status: 502, headers: { 'content-type': 'application/json' } },
          );
        },
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro' }));
    const panel = screen.getByTestId('change-plan-panel');
    fireEvent.click(within(panel).getByRole('button', { name: 'Confirm upgrade' }));

    // Panel gone, outcome-neutral notice up, picker locked: the
    // money-moving confirm is no longer armed, and the poll owns the
    // reconciliation (the flip machinery is kind-agnostic and covered
    // by the paid→paid switch test above).
    const notice = await screen.findByTestId('payment-processing-notice');
    expect(notice).toHaveTextContent('Plan change unconfirmed — confirming your plan.');
    expect(notice).toHaveTextContent(/may or may not have gone through/);
    expect(screen.queryByTestId('change-plan-panel')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /Switch to/ })).toHaveLength(0);
    expect(changeAttempts).toBe(1);
    // The persisted lock survives (a reload would re-lock).
    const stored = window.localStorage.getItem(pendingCheckoutKey('w'));
    expect(stored).not.toBeNull();
    expect((JSON.parse(stored!) as { kind: string }).kind).toBe('change_unconfirmed');
  });

  it('an interrupted change attempt locks the NEXT mount; release is a two-step assertion', async () => {
    // The attempt lock is written BEFORE the request — a reload/unmount
    // mid-flight leaves this record with no observed outcome. A fresh
    // mount must lock, and the only manual exit is the explicit
    // checked-first release.
    mockTier = 'plus';
    window.localStorage.setItem(
      pendingCheckoutKey('w'),
      JSON.stringify({
        workspaceId: 'w',
        kind: 'change_unconfirmed',
        fromTier: 'plus',
        fromCycle: 'monthly',
        toTier: 'pro',
        toCycle: 'annual',
        at: Date.now() - 16 * 60_000,
      }),
    );
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PLUS_SUB }),
      },
    ]);
    renderScreen();

    const notice = await screen.findByTestId('payment-processing-notice');
    expect(notice).toHaveTextContent(
      'Plan change unconfirmed — your plan change hasn’t come through yet.',
    );
    expect(screen.queryAllByRole('button', { name: /Switch to/ })).toHaveLength(0);

    // Two-step: first click states the risk and releases nothing.
    fireEvent.click(
      within(notice).getByRole('button', { name: 'The change didn’t apply — let me retry' }),
    );
    const releaseConfirm = within(notice).getByTestId('release-confirm');
    expect(releaseConfirm).toHaveTextContent(/can move money again/i);
    expect(window.localStorage.getItem(pendingCheckoutKey('w'))).not.toBeNull();

    fireEvent.click(within(releaseConfirm).getByRole('button', { name: 'Keep waiting' }));
    expect(within(notice).queryByTestId('release-confirm')).not.toBeInTheDocument();

    // Only the confirmed assertion releases.
    fireEvent.click(
      within(notice).getByRole('button', { name: 'The change didn’t apply — let me retry' }),
    );
    fireEvent.click(
      within(notice).getByRole('button', { name: 'I checked — nothing applied. Let me retry' }),
    );
    expect(screen.queryByTestId('payment-processing-notice')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Switch to Pro' })).toBeInTheDocument();
    expect(window.localStorage.getItem(pendingCheckoutKey('w'))).toBeNull();
  });

  it('a change confirm STANDS DOWN when another tab holds the money-action mutex', async () => {
    // Web Locks path: `ifAvailable` hands the callback `null` when the
    // mutex is held elsewhere — the claim must refuse and fire nothing,
    // even with an EMPTY pending slot (the other tab is mid-write).
    mockTier = 'plus';
    let changePosts = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PLUS_SUB }),
      },
      {
        method: 'POST',
        path: '/api/billing/change-plan',
        respond: () => {
          changePosts += 1;
          return jsonOk({ data: PLUS_SUB });
        },
      },
    ]);
    const heldLocks = {
      request: (_name: string, _opts: unknown, cb: (lock: null) => Promise<unknown>) => cb(null),
    };
    Object.defineProperty(window.navigator, 'locks', {
      value: heldLocks,
      configurable: true,
    });
    try {
      renderScreen();
      fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro' }));
      const panel = screen.getByTestId('change-plan-panel');
      fireEvent.click(within(panel).getByRole('button', { name: 'Confirm upgrade' }));

      // Stand-down: panel closes, nothing fires, nothing was written.
      await waitFor(() =>
        expect(screen.queryByTestId('change-plan-panel')).not.toBeInTheDocument(),
      );
      expect(changePosts).toBe(0);
      expect(window.localStorage.getItem(pendingCheckoutKey('w'))).toBeNull();
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window.navigator as any).locks;
    }
  });

  it('a change confirm STANDS DOWN — no POST — when a lock raced ahead of the storage event', async () => {
    // Same race as the checkout stand-down, on the change-plan path:
    // the pessimistic attempt write must not clobber the silent lock,
    // and the money-moving POST must never fire.
    mockTier = 'plus';
    let changePosts = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PLUS_SUB }),
      },
      {
        method: 'POST',
        path: '/api/billing/change-plan',
        respond: () => {
          changePosts += 1;
          return jsonOk({ data: PLUS_SUB });
        },
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro' }));
    // Lock lands silently — no storage event reaches this tab.
    window.localStorage.setItem(
      pendingCheckoutKey('w'),
      JSON.stringify({
        workspaceId: 'w',
        kind: 'change_unconfirmed',
        fromTier: 'plus',
        fromCycle: 'monthly',
        toTier: 'plus',
        toCycle: 'annual',
        at: Date.now(),
      }),
    );

    const panel = screen.getByTestId('change-plan-panel');
    fireEvent.click(within(panel).getByRole('button', { name: 'Confirm upgrade' }));

    expect(await screen.findByTestId('payment-processing-notice')).toHaveTextContent(
      'Plan change unconfirmed',
    );
    expect(changePosts).toBe(0);
    const record = JSON.parse(window.localStorage.getItem(pendingCheckoutKey('w'))!) as {
      kind: string;
      toCycle: string;
      attemptId?: string;
    };
    expect(record.kind).toBe('change_unconfirmed');
    expect(record.toCycle).toBe('annual');
    expect(record.attemptId).toBeUndefined();
  });

  it('a lock landing from ANOTHER tab disarms an already-open confirm panel', async () => {
    // The open panel's Confirm is charge-capable — it must not outlive
    // a lock that says a money outcome elsewhere is unresolved.
    mockTier = 'plus';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PLUS_SUB }),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro' }));
    expect(screen.getByTestId('change-plan-panel')).toBeInTheDocument();

    const record = writePendingCheckout(
      'w',
      'change_unconfirmed',
      'plus',
      'monthly',
      'pro',
      'annual',
    );
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: pendingCheckoutKey('w'),
          newValue: JSON.stringify(record),
        }),
      );
    });

    expect(screen.getByTestId('payment-processing-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('change-plan-panel')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /Switch to|Confirm upgrade/ })).toHaveLength(0);
  });

  it('a provider error on a $0 deferred downgrade stays inline — retry is charge-free', async () => {
    mockTier = 'pro';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PRO_SUB }),
      },
      {
        method: 'POST',
        path: '/api/billing/change-plan',
        respond: () =>
          new Response(
            JSON.stringify({ error: { code: 'BILLING_PROVIDER_ERROR', message: 'ignored' } }),
            { status: 502, headers: { 'content-type': 'application/json' } },
          ),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Plus' }));
    const panel = screen.getByTestId('change-plan-panel');
    fireEvent.click(within(panel).getByRole('button', { name: 'Schedule downgrade' }));

    const alert = await within(panel).findByRole('alert');
    expect(alert).toHaveTextContent(/never charges anything/);
    expect(alert).not.toHaveTextContent(/could not be reached/);
    expect(screen.queryByTestId('payment-processing-notice')).not.toBeInTheDocument();
  });

  it('a DEFINITIVE provider rejection on an upgrade stays inline — nothing applied, retry safe', async () => {
    // details.providerOutcome='definitive' means the provider itself
    // refused the call — outcome KNOWN, no lock, honest declined copy.
    mockTier = 'plus';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PLUS_SUB }),
      },
      {
        method: 'POST',
        path: '/api/billing/change-plan',
        respond: () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'BILLING_PROVIDER_ERROR',
                message: 'ignored',
                details: { providerOutcome: 'definitive' },
              },
            }),
            { status: 502, headers: { 'content-type': 'application/json' } },
          ),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro' }));
    const panel = screen.getByTestId('change-plan-panel');
    fireEvent.click(within(panel).getByRole('button', { name: 'Confirm upgrade' }));

    const alert = await within(panel).findByRole('alert');
    expect(alert).toHaveTextContent(/declined this change — nothing was applied or charged/);
    expect(screen.queryByTestId('payment-processing-notice')).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Confirm upgrade' })).toBeEnabled();
    // Known outcome ⇒ the pessimistic attempt lock was released.
    expect(window.localStorage.getItem(pendingCheckoutKey('w'))).toBeNull();
  });

  it('a known outcome releases ONLY its own attempt lock, never a concurrent rewrite', async () => {
    // Release is UUID-matched: while attempt A's request is in flight,
    // a concurrent attempt (same target — target matching would alias)
    // re-writes the per-workspace key. A's definitive failure must NOT
    // clear that other attempt's unresolved lock.
    mockTier = 'plus';
    let resolveChange: ((r: Response) => void) | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PLUS_SUB }),
      },
      {
        method: 'POST',
        path: '/api/billing/change-plan',
        respond: () => new Promise<Response>((resolve) => (resolveChange = resolve)),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro' }));
    const panel = screen.getByTestId('change-plan-panel');
    fireEvent.click(within(panel).getByRole('button', { name: 'Confirm upgrade' }));
    await waitFor(() => expect(resolveChange).not.toBeNull());

    // A wrote its lock (with its own attemptId) at click time.
    const mine = window.localStorage.getItem(pendingCheckoutKey('w'));
    expect(mine).not.toBeNull();

    // Concurrent attempt B re-writes the key — SAME target, different id.
    const foreign = {
      ...(JSON.parse(mine!) as Record<string, unknown>),
      attemptId: 'attempt-B',
      at: Date.now(),
    };
    window.localStorage.setItem(pendingCheckoutKey('w'), JSON.stringify(foreign));

    // A's outcome arrives: DEFINITIVE rejection.
    act(() => {
      resolveChange!(
        new Response(
          JSON.stringify({
            error: {
              code: 'BILLING_PROVIDER_ERROR',
              message: 'ignored',
              details: { providerOutcome: 'definitive' },
            },
          }),
          { status: 502, headers: { 'content-type': 'application/json' } },
        ),
      );
    });
    await within(panel).findByRole('alert');

    // B's unresolved lock survives A's known outcome.
    const after = window.localStorage.getItem(pendingCheckoutKey('w'));
    expect(after).not.toBeNull();
    expect((JSON.parse(after!) as { attemptId: string }).attemptId).toBe('attempt-B');
  });

  it('an ACCEPTED change never clobbers a concurrent attempt’s unresolved lock', async () => {
    // While attempt A's request is in flight, attempt B re-writes the
    // key. A is then ACCEPTED — but startPending('change') must not
    // replace B's change_unconfirmed lock (B's charge outcome is still
    // unknown); the screen surfaces B's lock instead.
    mockTier = 'plus';
    let resolveChange: ((r: Response) => void) | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: PLUS_SUB }),
      },
      {
        method: 'POST',
        path: '/api/billing/change-plan',
        respond: () => new Promise<Response>((resolve) => (resolveChange = resolve)),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro' }));
    const panel = screen.getByTestId('change-plan-panel');
    fireEvent.click(within(panel).getByRole('button', { name: 'Confirm upgrade' }));
    await waitFor(() => expect(resolveChange).not.toBeNull());

    const mine = window.localStorage.getItem(pendingCheckoutKey('w'));
    const foreign = {
      ...(JSON.parse(mine!) as Record<string, unknown>),
      toTier: 'plus',
      toCycle: 'annual',
      attemptId: 'attempt-B',
      at: Date.now(),
    };
    window.localStorage.setItem(pendingCheckoutKey('w'), JSON.stringify(foreign));

    // A's outcome arrives: ACCEPTED (pre-change body, §10).
    act(() => {
      resolveChange!(
        new Response(JSON.stringify({ data: PLUS_SUB }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    // B's lock survives verbatim and is what the screen surfaces.
    const notice = await screen.findByTestId('payment-processing-notice');
    expect(notice).toHaveTextContent('Plan change unconfirmed');
    const after = window.localStorage.getItem(pendingCheckoutKey('w'));
    expect((JSON.parse(after!) as { attemptId: string }).attemptId).toBe('attempt-B');
    expect((JSON.parse(after!) as { toTier: string }).toTier).toBe('plus');
  });

  it('a Razorpay subscriber gets the honest support route, never the failing confirm', async () => {
    mockTier = 'plus';
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () =>
          jsonOk({
            data: {
              ...PLUS_SUB,
              subscription: PLUS_SUB.subscription
                ? { ...PLUS_SUB.subscription, provider: 'razorpay' }
                : null,
            },
          }),
      },
    ]);
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro' }));
    const panel = screen.getByTestId('razorpay-switch-panel');
    expect(panel).toHaveTextContent(/aren’t self-serve yet for subscriptions paid via Razorpay/);
    expect(
      within(panel)
        .getByRole('link', { name: /Email support/ })
        .getAttribute('href'),
    ).toContain('mailto:support@declutrmail.com');
    expect(screen.queryByTestId('change-plan-panel')).not.toBeInTheDocument();
    // No cycle-switch CTA on the current card either — nothing that
    // routes a Razorpay sub into the unsupported endpoint.
    expect(
      screen.queryByRole('button', { name: /Switch to (monthly|annual) billing/ }),
    ).not.toBeInTheDocument();
  });

  it('a paused subscription shows the honest paused notice; Resume POSTs and enters pending', async () => {
    mockTier = 'free';
    let resumed = false;
    const pausedBody: BillingSubscription = {
      tier: 'free',
      foundingMember: false,
      pendingCheckout: null,
      subscription: { ...SUB, tier: 'plus', status: 'paused' },
    };
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: pausedBody }),
      },
      {
        method: 'POST',
        path: '/api/billing/resume',
        respond: () => {
          resumed = true;
          return jsonOk({ data: pausedBody }); // pre-resume state (§10)
        },
      },
    ]);
    renderScreen();

    // Card tells ONE story: entitlement Free, $0 — the paused row's
    // price/status/cancel never leak onto it. "No card on file" is a
    // provider claim the paused record contradicts, so it's absent too.
    const card = await screen.findByTestId('current-plan-card');
    expect(within(card).getByText('Free')).toBeInTheDocument();
    expect(within(card).getByText('$0')).toBeInTheDocument();
    expect(within(card).queryByText(/\$9/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/no card on file/)).not.toBeInTheDocument();
    expect(
      within(card).queryByRole('button', { name: 'Cancel subscription' }),
    ).not.toBeInTheDocument();

    // The paused notice owns the story + both exits.
    const notice = screen.getByTestId('non-backing-subscription-notice');
    expect(notice).toHaveTextContent('Your Plus subscription is paused');
    // The entitlement claim is DERIVED from the server read, never
    // hardcoded — this fixture's tier is free, so the copy may say so.
    expect(notice).toHaveTextContent('your account is on Free');
    expect(within(notice).getByRole('button', { name: 'Cancel subscription' })).toBeInTheDocument();

    // Plan changes stay locked while paused.
    expect(screen.queryByRole('button', { name: /Upgrade to|Switch to/ })).not.toBeInTheDocument();

    fireEvent.click(within(notice).getByRole('button', { name: 'Review resume' }));
    const resumePanel = within(notice).getByTestId('resume-confirm-panel');
    expect(resumePanel).toHaveTextContent('$0 is due today');
    expect(resumePanel).toHaveTextContent('through Jul 1, 2026');
    expect(resumed).toBe(false);
    fireEvent.click(within(resumePanel).getByRole('button', { name: 'Confirm resume Plus' }));
    await waitFor(() => expect(resumed).toBe(true));
    expect(await screen.findByTestId('payment-processing-notice')).toHaveTextContent(
      'Resume accepted — confirming your plan.',
    );
  });
});

describe('BillingScreen — one billing story (A6)', () => {
  it('Pro entitlement + paused Plus row: ONE current plan, no invented price, consequence-stating resume', async () => {
    // The A6 repro: entitlement tier (pro) ≠ subscription row (paused
    // plus). The screen must tell ONE story — the entitlement — and the
    // row is a non-backing record with honest, consequence-stating verbs.
    mockTier = 'pro';
    mockCleanupRemaining = null;
    stubSubscription(() =>
      jsonOk({
        data: {
          tier: 'pro',
          foundingMember: false,
          pendingCheckout: null,
          subscription: { ...SUB, tier: 'plus', status: 'paused' },
        },
      }),
    );
    renderScreen();

    // The card asserts the entitlement and NOTHING it can't know: no
    // quoted Pro price (nobody is charged it) and no leaked Plus price.
    const card = await screen.findByTestId('current-plan-card');
    expect(within(card).getByText('Pro')).toBeInTheDocument();
    expect(within(card).queryByText(quotedPlanPrice('pro', 'monthly')!)).not.toBeInTheDocument();
    expect(within(card).queryByText(quotedPlanPrice('plus', 'monthly')!)).not.toBeInTheDocument();
    expect(within(card).getByText('Included with your account')).toBeInTheDocument();
    expect(
      within(card).queryByRole('button', { name: 'Cancel subscription' }),
    ).not.toBeInTheDocument();

    // The notice describes the row as a paused subscription record,
    // names exactly ONE plan as current (the entitlement), and states
    // the real consequence of resuming: the webhook recompute re-grants
    // from subscription rows, which can move the workspace off Pro.
    const notice = screen.getByTestId('non-backing-subscription-notice');
    expect(notice).toHaveTextContent('paused Plus subscription');
    expect(notice).toHaveTextContent('Your account is on Pro');
    expect(notice).not.toHaveTextContent('Resume to reactivate Plus');
    expect(notice).toHaveTextContent(/can move your account off Pro/);
    expect(within(notice).getByRole('button', { name: 'Cancel subscription' })).toBeInTheDocument();

    // The paused row still occupies the server's one-live-subscription
    // slot (SUBSCRIPTION_EXISTS keys on STATUS, not backing) — a new
    // checkout would 409, so the picker withholds every checkout
    // affordance until the row is resumed or canceled. The notice above
    // carries those verbs.
    expect(screen.queryByRole('button', { name: 'Upgrade to Plus' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('change-plan-panel')).not.toBeInTheDocument();
  });

  it('Pro entitlement with NO subscription: no price claim, picker available', async () => {
    mockTier = 'pro';
    mockCleanupRemaining = null;
    stubSubscription(() =>
      jsonOk({
        data: { tier: 'pro', foundingMember: false, subscription: null, pendingCheckout: null },
      }),
    );
    renderScreen();

    // A comped/admin-granted tier is charged by NOBODY — the card must
    // not render the quote as if it were the bill.
    const card = await screen.findByTestId('current-plan-card');
    expect(within(card).getByText('Pro')).toBeInTheDocument();
    expect(within(card).getByText('Included with your account')).toBeInTheDocument();
    expect(within(card).queryByText(quotedPlanPrice('pro', 'monthly')!)).not.toBeInTheDocument();
    expect(within(card).queryByText(quotedPlanPrice('pro', 'annual')!)).not.toBeInTheDocument();
    expect(screen.queryByTestId('non-backing-subscription-notice')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade to Plus' })).toBeInTheDocument();
  });

  it('a non-backing past_due row surfaces its dunning warning and locks new checkouts', async () => {
    mockTier = 'pro';
    stubSubscription(() =>
      jsonOk({
        data: {
          tier: 'pro',
          foundingMember: false,
          pendingCheckout: null,
          subscription: { ...SUB, tier: 'plus', status: 'past_due' },
        },
      }),
    );
    renderScreen();

    const notice = await screen.findByTestId('non-backing-subscription-notice');
    // D119/ADR-0035: this row is NOT the one granting the plan, so its
    // dunning line routes to support rather than to the payment-method
    // section — that section acts on the granting subscription, and
    // sending the customer there could update the wrong card. The old
    // copy ("update your payment method with the provider") named no
    // destination at all.
    expect(notice).toHaveTextContent('Payment past due on this subscription');
    expect(notice).toHaveTextContent('support@declutrmail.com');
    expect(notice).toHaveTextContent('Your account is on Pro');
    // The mismatch row never puts its price on the card…
    const card = screen.getByTestId('current-plan-card');
    expect(within(card).queryByText(quotedPlanPrice('plus', 'monthly')!)).not.toBeInTheDocument();
    // …and it still occupies the server's one-live-subscription slot
    // (status past_due ∈ SUBSCRIPTION_EXISTS), so no checkout affordance
    // renders at all.
    expect(screen.queryByRole('button', { name: 'Upgrade to Plus' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('change-plan-panel')).not.toBeInTheDocument();
  });

  it('a canceled row renders the truthful subscription-ended line', async () => {
    mockTier = 'free';
    stubSubscription(() =>
      jsonOk({
        data: {
          tier: 'free',
          foundingMember: false,
          pendingCheckout: null,
          subscription: { ...SUB, status: 'canceled', currentPeriodEnd: null },
        },
      }),
    );
    renderScreen();

    const notice = await screen.findByTestId('non-backing-subscription-notice');
    expect(notice).toHaveTextContent('Your Pro subscription ended.');
    expect(notice).toHaveTextContent('Your account is on Free.');
    // No resume/cancel verbs on an ended row.
    expect(within(notice).queryByRole('button')).not.toBeInTheDocument();
    // "No card on file" stays off while a provider record exists, and
    // the ended row does not lock the picker.
    const card = screen.getByTestId('current-plan-card');
    expect(within(card).queryByText(/no card on file/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument();
  });

  it('a malformed 200 payload renders the honest unknown state, never invented facts', async () => {
    mockTier = 'free';
    let attempts = 0;
    stubSubscription(() => {
      attempts += 1;
      return attempts === 1
        ? jsonOk({ data: { tier: 'galactic', subscription: 'not-a-record' } })
        : jsonOk({ data: FREE_BODY });
    });
    renderScreen();

    // Unknown stays unknown: no TIER_MANIFEST[garbage] crash, no
    // invented card or picker — the honest read-failed-grade state.
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: "We couldn't read your billing details" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('current-plan-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-picker')).not.toBeInTheDocument();

    // Retry against a now-valid payload recovers normally.
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    const card = await screen.findByTestId('current-plan-card');
    expect(within(card).getByText('Free')).toBeInTheDocument();
  });
});

describe('D119 billing-artifact render gates (screen-level)', () => {
  const EMPTY_INVOICES = {
    invoices: [],
    unavailableProviders: [],
    truncated: false,
    omittedRows: 0,
  };

  /** Both billing reads stubbed — the screen mounts the invoice section. */
  function stubBillingReads(subscription: BillingSubscription) {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/billing/subscription',
        respond: () => jsonOk({ data: subscription }),
      },
      {
        method: 'GET',
        path: '/api/billing/invoices',
        respond: () => jsonOk({ data: EMPTY_INVOICES }),
      },
    ]);
  }

  it('billing dark renders NEITHER section and fetches no invoices', async () => {
    let invoicesFetched = false;
    installFetchStub([
      { method: 'GET', path: '/api/billing/subscription', respond: billingDisabled503 },
      {
        method: 'GET',
        path: '/api/billing/invoices',
        respond: () => {
          invoicesFetched = true;
          return jsonOk({ data: EMPTY_INVOICES });
        },
      },
    ]);
    renderScreen();
    await screen.findByTestId('billing-disabled-notice');
    expect(screen.queryByTestId('payment-method-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invoice-history')).not.toBeInTheDocument();
    expect(invoicesFetched).toBe(false);
  });

  it('a never-subscribed free workspace gets no invoice section and no payment-method card', async () => {
    stubBillingReads({
      tier: 'free',
      foundingMember: false,
      subscription: null,
      pendingCheckout: null,
    });
    renderScreen();
    await screen.findByTestId('current-plan-card');
    expect(screen.queryByTestId('invoice-history')).not.toBeInTheDocument();
    expect(screen.queryByTestId('payment-method-card')).not.toBeInTheDocument();
  });

  it('free-but-PREVIOUSLY-paid keeps invoices reachable — the tax need outlives the subscription', async () => {
    stubBillingReads({
      tier: 'free',
      foundingMember: false,
      pendingCheckout: null,
      subscription: { ...SUB, tier: 'plus', status: 'canceled', currentPeriodEnd: null },
    });
    renderScreen();
    expect(await screen.findByTestId('invoice-history')).toBeInTheDocument();
    // …but a canceled row's card is not something to send anyone to update.
    expect(screen.queryByTestId('payment-method-card')).not.toBeInTheDocument();
  });

  it('an active subscriber gets both sections', async () => {
    stubBillingReads(PRO_SUB);
    renderScreen();
    expect(await screen.findByTestId('payment-method-card')).toBeInTheDocument();
    expect(await screen.findByTestId('invoice-history')).toBeInTheDocument();
  });

  it('cancel_scheduled + past_due keeps the payment-method affordance — dunning continues to period end', async () => {
    // The derive layer collapses a past_due row under cancel_scheduled
    // (cancelAtPeriodEnd wins), but the failing card still needs fixing
    // until the period actually ends (gate network 2026-08-16).
    stubBillingReads({
      tier: 'pro',
      foundingMember: false,
      pendingCheckout: null,
      subscription: {
        ...SUB,
        status: 'past_due',
        cancelAtPeriodEnd: true,
        cancelSource: 'provider',
      },
    });
    renderScreen();
    const card = await screen.findByTestId('payment-method-card');
    expect(within(card).getByText(/didn’t go through/i)).toBeInTheDocument();
  });

  it('a pending money action withholds the payment-method control and says why', async () => {
    stubBillingReads(PRO_SUB);
    // The localStorage lock is the pending-payment machine's persisted
    // form — written the way the checkout flow writes it. The awaited
    // target must NOT match the stubbed read (pro/monthly), or the
    // tier-flip detector rightly clears the lock on first data.
    writePendingCheckout('w', 'checkout', 'pro', 'monthly', 'pro', 'annual');
    renderScreen();
    const card = await screen.findByTestId('payment-method-card');
    expect(within(card).getByRole('button', { name: 'Update payment method' })).toBeDisabled();
    expect(within(card).getByText(/finishes confirming/i)).toBeInTheDocument();
  });
});
