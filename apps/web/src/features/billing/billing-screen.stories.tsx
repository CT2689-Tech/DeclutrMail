// Storybook CSF3 stories for the BillingScreen (D119/D120/D121, D210).
//
// The screen reads `me` (AuthProvider) + the billing subscription
// query. Each story mounts a QueryClient with prefilled cache state so
// every variant renders deterministically; the billing-disabled story
// stubs `fetch` instead (the 503 designed state can't be cache-primed).
//
// Mirrors the local-shim pattern used by sibling stories so the file
// typechecks before the PR-3 Storybook seed merges (D210).

import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { tokens } from '@declutrmail/shared';
import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { AuthProvider } from '@/features/auth/auth-provider';
import { ME_QUERY_KEY, type Me } from '@/features/auth/api/use-me';

import { billingKeys } from './api/query-keys';
import { BillingScreen, PaymentProcessingNotice } from './billing-screen';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  parameters?: Record<string, unknown>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

function meFixture(tier: Me['tier'], cleanupRemaining: number | null): Me {
  return {
    user: { id: 'u-1', email: 'me@example.com', workspaceId: 'w-1', timezone: null },
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
    tier,
    cleanupRemaining,
  };
}

const FREE_BODY: BillingSubscription = {
  complimentary: null,
  tier: 'free',
  foundingMember: false,
  subscription: null,
  pendingCheckout: null,
};

const PRO_SUB: BillingSubscription = {
  complimentary: null,
  tier: 'pro',
  foundingMember: false,
  pendingCheckout: null,
  subscription: {
    provider: 'paddle',
    tier: 'pro',
    status: 'active',
    cycle: 'monthly',
    currentPeriodEnd: '2026-08-15T12:00:00.000Z',
    cancelAtPeriodEnd: false,
    cancelSource: null,
    pauseUntil: null,
    foundingMember: false,
    scheduledChange: null,
  },
};

function makeClient(me: Me, billing: BillingSubscription | null): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  client.setQueryData(ME_QUERY_KEY, me);
  if (billing) {
    client.setQueryData(billingKeys.subscription(), billing);
  }
  return client;
}

function frame(client: QueryClient, props?: ComponentProps<typeof BillingScreen>) {
  return (
    <div style={{ background: tokens.color.bg, minHeight: 600, padding: 12 }}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <BillingScreen {...props} />
        </AuthProvider>
      </QueryClientProvider>
    </div>
  );
}

const meta: StoryMeta<typeof BillingScreen> = {
  title: 'Features/Billing/BillingScreen',
  component: BillingScreen,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Billing screen (D117/D119): current-plan card + inline plan picker — ONE monthly/annual segmented control (manifest-derived "2 months free" badge) re-prices every card; each plan carries one CTA into the D226 confirm step, then the provider surface. Post-checkout the screen shows the truthful PAYMENT-PROCESSING state and polls until the webhook flips the tier (§10 — never optimistic). All prices come off the D19 entitlement manifest. While billing is dark (503 BILLING_DISABLED) the screen renders the honest designed state.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Free workspace — $0 card, lifetime-cleanup counter, Free marked current,
 *  picker with the annual-default toggle + per-plan Upgrade CTAs. */
export const FreeTier: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(makeClient(meFixture('free', 3), FREE_BODY)),
};

/** Deep-linked intent (pricing page / gate nudge / TierGate) — the D226
 *  confirm step opens pre-selected: one click left to the provider. */
export const IntentConfirmOpen: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(makeClient(meFixture('free', 3), FREE_BODY), {
      initialIntent: { plan: 'pro', cycle: 'annual', promo: 'foundingPro' },
    }),
};

/** The truthful post-checkout state (§10): payment made in the overlay,
 *  tier grant pending the webhook — the screen polls, never claims. */
export const PaymentProcessing: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) => (
    <div style={{ background: tokens.color.bg, minHeight: 120, padding: 12 }}>
      <PaymentProcessingNotice />
    </div>
  ),
};

/** The elapsed branch of "usually within a minute" — still honest,
 *  still polling, with the support escape hatch. */
export const PaymentProcessingSlow: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) => (
    <div style={{ background: tokens.color.bg, minHeight: 120, padding: 12 }}>
      <PaymentProcessingNotice phase="slow" />
    </div>
  ),
};

/** 15+ minutes unconfirmed: checkout stays locked against a double
 *  charge; the only releases are the tier flip or the user's explicit
 *  "no charge went through" assertion. */
export const PaymentUnconfirmed: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) => (
    <div style={{ background: tokens.color.bg, minHeight: 160, padding: 12 }}>
      <PaymentProcessingNotice phase="unconfirmed" onRelease={() => {}} />
    </div>
  ),
};

/** Active Pro subscriber — renewal date, provider, cancel affordance. */
export const ProSubscriber: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(makeClient(meFixture('pro', null), PRO_SUB)),
};

/** Pro remains effective while a Plus downgrade waits for renewal. */
export const DowngradeScheduled: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('pro', null), {
        ...PRO_SUB,
        subscription: PRO_SUB.subscription
          ? {
              ...PRO_SUB.subscription,
              scheduledChange: {
                tier: 'plus',
                cycle: 'monthly',
                effectiveAt: '2026-08-15T12:00:00.000Z',
                state: 'scheduled',
              },
            }
          : null,
      }),
    ),
};

/** Downgrade requested but the provider hasn't confirmed it yet —
 *  billing changes stay locked while the marker reconciles. */
export const DowngradeConfirming: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('pro', null), {
        ...PRO_SUB,
        subscription: PRO_SUB.subscription
          ? {
              ...PRO_SUB.subscription,
              scheduledChange: {
                tier: 'plus',
                cycle: 'monthly',
                effectiveAt: '2026-08-15T12:00:00.000Z',
                state: 'pending_provider',
              },
            }
          : null,
      }),
    ),
};

/** "Keep current plan" requested — restore awaiting Paddle's confirmation,
 *  with the retry CTA. */
export const DowngradeRestoring: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('pro', null), {
        ...PRO_SUB,
        subscription: PRO_SUB.subscription
          ? {
              ...PRO_SUB.subscription,
              scheduledChange: {
                tier: 'plus',
                cycle: 'monthly',
                effectiveAt: '2026-08-15T12:00:00.000Z',
                state: 'restoring_current',
              },
            }
          : null,
      }),
    ),
};

/** Founding Pro member — locked-price banner (D126). */
export const FoundingMember: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('pro', null), {
        ...PRO_SUB,
        foundingMember: true,
        pendingCheckout: null,
        complimentary: null,
        subscription: PRO_SUB.subscription
          ? { ...PRO_SUB.subscription, cycle: 'annual', foundingMember: true }
          : null,
      }),
    ),
};

/** Cancellation scheduled — warn note, cancel affordance withdrawn. */
export const CancelScheduled: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('pro', null), {
        ...PRO_SUB,
        subscription: PRO_SUB.subscription
          ? { ...PRO_SUB.subscription, cancelAtPeriodEnd: true }
          : null,
      }),
    ),
};

/**
 * Refund pending — the plan is HELD while the provider decides.
 *
 * The state a customer is in between asking for their money back and the
 * provider confirming it (2026-08-25). It renders on the same
 * cancel-scheduled card as the story above, which is exactly why it needs
 * its own: same layout, different tense, and the difference is the whole
 * point. `CancelScheduled` promises a date; this one deliberately does
 * not, because provider approval is a review queue with no SLA — the
 * first live one took 10.5 hours.
 *
 * Before this, the equivalent screen said the plan had ALREADY ended and
 * the account was on Free while the picker stayed locked — no product and
 * no way to buy one. That state is now the `RefundUnconfirmed` backstop
 * below, reachable only after a week of provider silence.
 */
export const RefundPending: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('pro', null), {
        ...PRO_SUB,
        subscription: PRO_SUB.subscription
          ? { ...PRO_SUB.subscription, cancelAtPeriodEnd: true, cancelSource: 'refund' }
          : null,
      }),
    ),
};

/**
 * Refund unconfirmed past the grace — the backstop, and the only state
 * here where a locked picker is unavoidable.
 *
 * `tier: 'free'` beside a still-`active` refund row: entitlement lapsed
 * because seven days passed with the provider neither confirming nor
 * rejecting. The copy names support rather than telling the customer to
 * wait, because by the time this renders, waiting has already failed.
 */
export const RefundUnconfirmed: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('free', null), {
        ...PRO_SUB,
        tier: 'free',
        subscription: PRO_SUB.subscription
          ? { ...PRO_SUB.subscription, cancelAtPeriodEnd: true, cancelSource: 'refund' }
          : null,
      }),
    ),
};

/** Payment past due — provider-side dunning surfaced honestly. */
export const PastDue: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('pro', null), {
        ...PRO_SUB,
        subscription: PRO_SUB.subscription ? { ...PRO_SUB.subscription, status: 'past_due' } : null,
      }),
    ),
};

/** Subscription paused — a paused plan grants NOTHING: the card tells
 *  the Free story, the paused notice owns Resume/Cancel, and plan
 *  changes stay locked (BE rejects with SUBSCRIPTION_PAUSED). */
export const Paused: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('free', 0), {
        complimentary: null,
        tier: 'free',
        foundingMember: false,
        pendingCheckout: null,
        subscription: PRO_SUB.subscription
          ? {
              ...PRO_SUB.subscription,
              tier: 'plus',
              status: 'paused',
              pauseUntil: '2026-08-03T12:00:00.000Z',
              currentPeriodEnd: '2026-08-15T12:00:00.000Z',
            }
          : null,
      }),
    ),
};

/** Razorpay paused — no self-serve resume promise; support route only
 *  (no-charge resume semantics unverified for this provider). */
export const PausedRazorpay: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('free', 0), {
        complimentary: null,
        tier: 'free',
        foundingMember: false,
        pendingCheckout: null,
        subscription: PRO_SUB.subscription
          ? {
              ...PRO_SUB.subscription,
              provider: 'razorpay',
              tier: 'plus',
              status: 'paused',
              pauseUntil: '2026-08-03T12:00:00.000Z',
              currentPeriodEnd: '2026-08-15T12:00:00.000Z',
            }
          : null,
      }),
    ),
};

/** A6 repro — entitlement Pro, paused PLUS row (tier_mismatch): the
 *  card tells ONE story (Pro, no price claim), the non-backing notice
 *  names the paused row as a record with consequence-stating resume
 *  copy, and the picker stays available (backing = none). */
export const ProEntitlementPausedPlusRow: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('pro', null), {
        complimentary: null,
        tier: 'pro',
        foundingMember: false,
        pendingCheckout: null,
        subscription: PRO_SUB.subscription
          ? {
              ...PRO_SUB.subscription,
              tier: 'plus',
              status: 'paused',
              pauseUntil: '2026-08-03T12:00:00.000Z',
            }
          : null,
      }),
    ),
};

/** Entitlement without any subscription (admin grant): the card makes
 *  NO price claim — "Included with your account", never a quote
 *  presented as the bill (A6). */
export const ProWithoutSubscription: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('pro', null), {
        complimentary: null,
        tier: 'pro',
        foundingMember: false,
        pendingCheckout: null,
        subscription: null,
      }),
    ),
};

/** A NON-BACKING past_due row (entitlement granted elsewhere) still
 *  surfaces its dunning warning through the non-backing notice (A6). */
export const NonBackingPastDue: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('pro', null), {
        complimentary: null,
        tier: 'pro',
        foundingMember: false,
        pendingCheckout: null,
        subscription: PRO_SUB.subscription
          ? { ...PRO_SUB.subscription, tier: 'plus', status: 'past_due' }
          : null,
      }),
    ),
};

/** A canceled row — the truthful "subscription ended" line; no card
 *  claims, no verbs, picker available (A6). */
export const SubscriptionEnded: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('free', 0), {
        complimentary: null,
        tier: 'free',
        foundingMember: false,
        pendingCheckout: null,
        subscription: PRO_SUB.subscription
          ? { ...PRO_SUB.subscription, status: 'canceled', currentPeriodEnd: null }
          : null,
      }),
    ),
};

/**
 * The UNKNOWN designed state (A6): the read answered 200 with a payload
 * outside the contract schema — the screen shows honest ignorance,
 * never TIER_MANIFEST[garbage] or an invented price. Stubs fetch since
 * an error state cannot be cache-primed.
 */
export const BillingUnknown: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { tier: 'galactic', subscription: 'not-a-record' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )) as typeof globalThis.fetch;
    return frame(makeClient(meFixture('free', 5), null));
  },
};

/** Plus subscriber — every non-current card carries a bottom-aligned
 *  "Switch to …" CTA into the D226 change-plan preview (D117/D120). */
export const PlusSubscriber: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('plus', null), {
        complimentary: null,
        tier: 'plus',
        foundingMember: false,
        pendingCheckout: null,
        subscription: PRO_SUB.subscription ? { ...PRO_SUB.subscription, tier: 'plus' } : null,
      }),
    ),
};

/**
 * Billing dark (503 BILLING_DISABLED) — the designed state while the
 * founder hasn't flipped BILLING_ENABLED: honest notice, plan card from
 * `me`, no checkout affordances. Stubs fetch since an error state
 * cannot be cache-primed.
 */
export const BillingDisabled: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: 'BILLING_DISABLED', message: 'Billing is not available yet.' },
          }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        ),
      )) as typeof globalThis.fetch;
    return frame(makeClient(meFixture('free', 5), null));
  },
};
