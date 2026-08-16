// Storybook CSF3 stories for the D119 / ADR-0035 billing-artifact
// sections (D210).
//
// The invoice list is a network read, so each story prefills the
// TanStack cache under `billingKeys.invoices()` rather than stubbing
// fetch — same shape as the sibling BillingScreen stories.
//
// The variants deliberately cover the honesty states, not just the
// happy row: a failed read, a partial list, an unmappable status, and
// Razorpay's typed refusal are the reasons these components exist.

import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { tokens } from '@declutrmail/shared';
import type { BillingInvoiceList } from '@declutrmail/shared/contracts';

import { billingKeys } from './api/query-keys';
import { InvoiceHistory } from './invoice-history';
import { PaymentMethodCard } from './payment-method-card';

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

const PAID = {
  id: 'txn_01',
  provider: 'paddle',
  issuedAt: '2026-05-01T00:00:00.000Z',
  amount: '1900',
  currencyCode: 'USD',
  status: 'paid',
  hostedUrl: null,
  documentAvailable: true,
} satisfies BillingInvoiceList['invoices'][number];

const RAZORPAY_ROW = {
  id: 'inv_01',
  provider: 'razorpay',
  issuedAt: '2026-04-01T00:00:00.000Z',
  amount: '99900',
  currencyCode: 'INR',
  status: 'paid',
  hostedUrl: 'https://rzp.io/i/example',
  documentAvailable: false,
} satisfies BillingInvoiceList['invoices'][number];

/**
 * A client whose invoice read is already settled. `retry: false`
 * mirrors the hook — a billing read's failure is a designed state, not
 * something to hammer.
 */
function clientWith(data: BillingInvoiceList): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(billingKeys.invoices(), data);
  return client;
}

/**
 * The failed read cannot be cache-primed (an error is a query STATE,
 * not data), so this variant stubs `fetch` and lets the hook fail for
 * real — the same approach the sibling billing-disabled story uses.
 */
function failingClient(): QueryClient {
  globalThis.fetch = (() =>
    Promise.reject(new Error('provider unavailable'))) as typeof globalThis.fetch;
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Frame({ client, children }: { client: QueryClient; children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <div
        style={{
          padding: 24,
          maxWidth: 920,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          fontFamily: tokens.font.sans,
          background: tokens.color.bg,
        }}
      >
        {children}
      </div>
    </QueryClientProvider>
  );
}

const meta: StoryMeta<typeof InvoiceHistory> = {
  title: 'Billing/Invoices & payment method',
  component: InvoiceHistory,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
};
export default meta;

export const WithInvoices: Story<typeof InvoiceHistory> = {
  render: () => (
    <Frame
      client={clientWith({
        invoices: [PAID, RAZORPAY_ROW],
        unavailableProviders: [],
        truncated: false,
      })}
    >
      <InvoiceHistory />
    </Frame>
  ),
};

/** First period, nothing collected yet — an empty state, not an error. */
export const NoInvoicesYet: Story<typeof InvoiceHistory> = {
  render: () => (
    <Frame client={clientWith({ invoices: [], unavailableProviders: [], truncated: false })}>
      <InvoiceHistory />
    </Frame>
  ),
};

/** The read failed. Must never read as "you have no invoices". */
export const ReadFailed: Story<typeof InvoiceHistory> = {
  render: () => (
    <Frame client={failingClient()}>
      <InvoiceHistory />
    </Frame>
  ),
};

/** One rail answered, the other did not — the list says it is partial. */
export const PartialList: Story<typeof InvoiceHistory> = {
  render: () => (
    <Frame
      client={clientWith({
        invoices: [PAID],
        unavailableProviders: ['razorpay'],
        truncated: false,
      })}
    >
      <InvoiceHistory />
    </Frame>
  ),
};

/** A status neither adapter maps — no word beats a wrong word. */
export const UnknownStatus: Story<typeof InvoiceHistory> = {
  render: () => (
    <Frame
      client={clientWith({
        invoices: [{ ...PAID, status: 'unknown' }],
        unavailableProviders: [],
        truncated: false,
      })}
    >
      <InvoiceHistory />
    </Frame>
  ),
};

const emptyClient = () => clientWith({ invoices: [], unavailableProviders: [], truncated: false });

export const PaymentMethodPaddle: Story<typeof PaymentMethodCard> = {
  render: () => (
    <Frame client={emptyClient()}>
      <PaymentMethodCard provider="paddle" isPastDue={false} />
    </Frame>
  ),
};

/** Dunning — this section becomes the screen's primary action. */
export const PaymentMethodPastDue: Story<typeof PaymentMethodCard> = {
  render: () => (
    <Frame client={emptyClient()}>
      <PaymentMethodCard provider="paddle" isPastDue />
    </Frame>
  ),
};

/** Razorpay has no self-serve path — a support route, never a dead button. */
export const PaymentMethodRazorpay: Story<typeof PaymentMethodCard> = {
  render: () => (
    <Frame client={emptyClient()}>
      <PaymentMethodCard provider="razorpay" isPastDue={false} />
    </Frame>
  ),
};

/** Withheld while a money action is unresolved, with the reason stated. */
export const PaymentMethodLocked: Story<typeof PaymentMethodCard> = {
  render: () => (
    <Frame client={emptyClient()}>
      <PaymentMethodCard
        provider="paddle"
        isPastDue={false}
        disabled
        disabledReason="Available once the payment above finishes confirming."
      />
    </Frame>
  ),
};

export type InvoiceHistoryProps = ComponentProps<typeof InvoiceHistory>;
