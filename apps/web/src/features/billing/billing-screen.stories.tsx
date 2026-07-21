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

const FREE_BODY: BillingSubscription = { tier: 'free', foundingMember: false, subscription: null };

const PRO_SUB: BillingSubscription = {
  tier: 'pro',
  foundingMember: false,
  subscription: {
    provider: 'paddle',
    tier: 'pro',
    status: 'active',
    cycle: 'monthly',
    currentPeriodEnd: '2026-07-01T12:00:00.000Z',
    cancelAtPeriodEnd: false,
    pauseUntil: null,
    foundingMember: false,
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

/** Founding Pro member — locked-price banner (D126). */
export const FoundingMember: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('pro', null), {
        ...PRO_SUB,
        foundingMember: true,
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

/** Subscription paused — muted status note with the resume date. */
export const Paused: Story<typeof BillingScreen> = {
  render: (_args: ComponentProps<typeof BillingScreen>) =>
    frame(
      makeClient(meFixture('pro', null), {
        ...PRO_SUB,
        subscription: PRO_SUB.subscription
          ? { ...PRO_SUB.subscription, status: 'paused', pauseUntil: '2026-08-03T12:00:00.000Z' }
          : null,
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
