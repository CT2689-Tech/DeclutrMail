/**
 * Tests for the D119 / ADR-0035 billing-artifact sections.
 *
 * The cases that matter here are the honesty ones, not the happy path:
 * a failed read must not read as "no invoices", a partial list must say
 * it is partial, an unmappable status must not be rounded to "Paid",
 * and Razorpay must never render a payment-method button whose only
 * outcome is a refusal.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

import type * as ApiClientModule from '@/lib/api/client';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof ApiClientModule>('@/lib/api/client');
  return {
    ...actual,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
  };
});

import { InvoiceHistory } from './invoice-history';
import { BillingInvoiceHistoryGate } from './billing-invoice-history-gate';
import { billingKeys } from './api/query-keys';
import { PaymentMethodCard } from './payment-method-card';

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const PAID_ROW = {
  id: 'txn_1',
  provider: 'paddle' as const,
  issuedAt: '2026-05-01T00:00:00.000Z',
  amount: '1900',
  currencyCode: 'USD',
  status: 'paid' as const,
  hostedUrl: null,
  documentAvailable: true,
};

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

describe('InvoiceHistory', () => {
  it('compacts only a verified empty history and keeps its section target', async () => {
    apiGet.mockResolvedValue({
      data: { invoices: [], unavailableProviders: [], truncated: false, omittedRows: 0 },
    });
    wrap(<InvoiceHistory />);
    expect(await screen.findByText('No invoices yet')).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'Payment history' });
    expect(section).toHaveAttribute('id', 'invoices');
    expect(section).toHaveAttribute('tabindex', '-1');
    expect(
      screen.queryByText('Payments and invoices from past subscriptions and one-time purchases.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('keeps a one-unit difference in large refund totals', async () => {
    apiGet.mockResolvedValue({
      data: {
        invoices: [{ ...PAID_ROW, amount: '9007199254740993', refundedAmount: '9007199254740992' }],
        unavailableProviders: [],
        truncated: false,
        omittedRows: 0,
      },
    });
    wrap(<InvoiceHistory />);
    expect(await screen.findByText('Partially refunded')).toBeInTheDocument();
    expect(screen.queryByText('Refunded', { exact: true })).not.toBeInTheDocument();
  });

  it.each([
    ['1900', 'Refunded'],
    ['500', 'Partially refunded'],
  ])(
    'shows a confirmed refund of %s and keeps the invoice download',
    async (refundedAmount, label) => {
      apiGet.mockResolvedValue({
        data: {
          invoices: [
            { ...PAID_ROW, refundedAmount },
            { ...PAID_ROW, id: 'txn_unreturned' },
          ],
          unavailableProviders: [],
          truncated: false,
          omittedRows: 0,
        },
      });
      wrap(<InvoiceHistory />);
      expect(await screen.findByText(label)).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(2);
      fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), {
        target: { value: refundedAmount === '1900' ? 'refunded' : 'partially_refunded' },
      });
      expect(screen.getByRole('status')).toHaveTextContent('1 of 2 loaded invoices');
      expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(1);
      expect(screen.queryByText('Paid', { exact: true })).not.toBeInTheDocument();
      expect(screen.getByRole('listitem')).toHaveAccessibleName(
        new RegExp(`status ${label}, refunded \\$${refundedAmount === '1900' ? '19.00' : '5.00'}`),
      );
    },
  );

  it.each(['complimentary Pro', 'Free', 'Pass'])(
    'loads past invoices for %s without a current subscription',
    async (state) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      });
      client.setQueryData(billingKeys.subscription(), {
        tier: state === 'Free' ? 'free' : state === 'Pass' ? 'plus' : 'pro',
        complimentary:
          state === 'Free'
            ? null
            : {
                tier: state === 'Pass' ? 'plus' : 'pro',
                expiresAt: null,
                source: state === 'Pass' ? 'pass' : 'comp',
              },
        subscription: null,
        pendingCheckout: null,
        foundingMember: false,
      });
      apiGet.mockResolvedValue({
        data: { invoices: [PAID_ROW], unavailableProviders: [], truncated: false, omittedRows: 0 },
      });
      render(
        <QueryClientProvider client={client}>
          <BillingInvoiceHistoryGate />
        </QueryClientProvider>,
      );
      expect(await screen.findByText('$19.00')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    },
  );

  it('filters only loaded invoice history by status and inclusive date, with recovery and older-history help', async () => {
    apiGet.mockResolvedValue({
      data: {
        invoices: [
          PAID_ROW,
          { ...PAID_ROW, id: 'txn_2', status: 'due', issuedAt: '2026-06-01T00:00:00.000Z' },
        ],
        unavailableProviders: [],
        truncated: true,
        omittedRows: 0,
      },
    });
    wrap(<InvoiceHistory />);
    await screen.findByText('2 of 2 loaded invoices. Filters apply to this loaded history only.');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'due' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('listitem')).toHaveAccessibleName(/status Due/);
    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-05-31' } });
    expect(screen.getByText('No loaded invoices match these filters.')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Request older invoices' })).toHaveAttribute(
      'href',
      'mailto:support@declutrmail.com?subject=Older%20invoice%20request',
    );
  });

  it('renders a paid row with its formatted amount and a download control', async () => {
    apiGet.mockResolvedValue({
      data: { invoices: [PAID_ROW], unavailableProviders: [], truncated: false, omittedRows: 0 },
    });
    wrap(<InvoiceHistory />);
    expect(await screen.findByText('$19.00')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('requests fresh owned documents per click without retaining signed URLs in query or mutation data', async () => {
    const navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    apiGet.mockImplementation((path: string) =>
      Promise.resolve({
        data: path.endsWith('/document')
          ? { provider: 'paddle', url: 'https://paddle.example/invoice.pdf' }
          : { invoices: [PAID_ROW], unavailableProviders: [], truncated: false, omittedRows: 0 },
      }),
    );
    try {
      render(
        <QueryClientProvider client={client}>
          <InvoiceHistory />
        </QueryClientProvider>,
      );
      const download = await screen.findByRole('button', { name: 'Download' });
      expect(apiGet.mock.calls.some((call) => String(call[0]).endsWith('/document'))).toBe(false);
      fireEvent.click(download);
      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith('https://paddle.example/invoice.pdf'),
      );
      expect(apiGet).toHaveBeenCalledWith('/api/billing/invoices/txn_1/document');
      expect(
        client
          .getQueryCache()
          .getAll()
          .some((query) => JSON.stringify(query.state.data ?? null).includes('invoice.pdf')),
      ).toBe(false);
      expect(
        client
          .getMutationCache()
          .getAll()
          .map((mutation) => mutation.state.data),
      ).toEqual([undefined]);
      await waitFor(() => expect(download).not.toBeDisabled());
      fireEvent.click(download);
      await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
      expect(
        apiGet.mock.calls.filter((call) => String(call[0]).endsWith('/document')),
      ).toHaveLength(2);
    } finally {
      navigate.mockRestore();
      client.clear();
    }
  });

  it('shows a real error state — never an empty list — when the read fails', async () => {
    apiGet.mockRejectedValue(new Error('boom'));
    wrap(<InvoiceHistory />);
    expect(await screen.findByText(/couldn’t load your invoices/i)).toBeInTheDocument();
    // A provider failure is a 200 with `unavailableProviders`, so this
    // state is always OUR failure — never "the provider didn't answer".
    expect(screen.queryByText(/provider didn.t answer/i)).toBeNull();
    expect(screen.queryByText(/no invoices yet/i)).not.toBeInTheDocument();
  });

  it('does not claim "no invoices" when the only rail we could ask was unreachable', async () => {
    apiGet.mockResolvedValue({
      data: { invoices: [], unavailableProviders: ['paddle'], truncated: false, omittedRows: 0 },
    });
    wrap(<InvoiceHistory />);
    // A provider that answered with an error was reached — the copy
    // claims only that invoices did not come back.
    expect(await screen.findByText(/didn’t return your invoices/i)).toBeInTheDocument();
    // The partial state carries its own way out.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText(/no invoices yet/i)).not.toBeInTheDocument();
  });

  it('says the list is partial when one rail failed but the other returned rows', async () => {
    apiGet.mockResolvedValue({
      data: {
        invoices: [PAID_ROW],
        unavailableProviders: ['razorpay'],
        truncated: false,
        omittedRows: 0,
      },
    });
    wrap(<InvoiceHistory />);
    expect(await screen.findByText(/may be missing invoices/i)).toBeInTheDocument();
  });

  it('renders no status word for a status it cannot map, rather than guessing "Paid"', async () => {
    apiGet.mockResolvedValue({
      data: {
        invoices: [{ ...PAID_ROW, status: 'unknown' as const }],
        unavailableProviders: [],
        truncated: false,
        omittedRows: 0,
      },
    });
    wrap(<InvoiceHistory />);
    await screen.findByText('$19.00');
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
    expect(screen.queryByText('Due')).not.toBeInTheDocument();
  });

  it('links a Razorpay row straight to its hosted page instead of minting one', async () => {
    apiGet.mockResolvedValue({
      data: {
        invoices: [
          {
            ...PAID_ROW,
            provider: 'razorpay' as const,
            currencyCode: 'INR',
            amount: '99900',
            hostedUrl: 'https://rzp.io/i/abc',
            documentAvailable: false,
          },
        ],
        unavailableProviders: [],
        truncated: false,
        omittedRows: 0,
      },
    });
    wrap(<InvoiceHistory />);
    const link = await screen.findByRole('link', { name: 'View invoice' });
    expect(link).toHaveAttribute('href', 'https://rzp.io/i/abc');
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
  });

  it('offers no control at all when a row has neither a hosted page nor a document', async () => {
    apiGet.mockResolvedValue({
      data: {
        invoices: [{ ...PAID_ROW, hostedUrl: null, documentAvailable: false }],
        unavailableProviders: [],
        truncated: false,
        omittedRows: 0,
      },
    });
    wrap(<InvoiceHistory />);
    expect(await screen.findByText('No document')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
  });

  it('discloses a truncated list rather than passing it off as complete', async () => {
    apiGet.mockResolvedValue({
      data: { invoices: [PAID_ROW], unavailableProviders: [], truncated: true, omittedRows: 0 },
    });
    wrap(<InvoiceHistory />);
    expect(await screen.findByText(/limited invoice history/i)).toBeInTheDocument();
  });

  it('never treats an empty capped history as proof that no invoices exist', async () => {
    apiGet.mockResolvedValue({
      data: { invoices: [], unavailableProviders: [], truncated: true, omittedRows: 0 },
    });
    wrap(<InvoiceHistory />);
    expect(await screen.findByText('No invoices in this limited history')).toBeInTheDocument();
    expect(screen.queryByText('No invoices yet')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request older invoices' })).toBeInTheDocument();
  });

  it('never claims "no invoices yet" when rows exist but none were renderable', async () => {
    // The all-rows-dropped shape: the provider answered, every row was
    // unrenderable (wrong field names would do exactly this), and the
    // customer DOES have invoices (gate network 2026-08-16, CONFIRMED).
    apiGet.mockResolvedValue({
      data: { invoices: [], unavailableProviders: [], truncated: false, omittedRows: 4 },
    });
    wrap(<InvoiceHistory />);
    expect(await screen.findByText(/couldn’t display this billing history/i)).toBeInTheDocument();
    expect(screen.queryByText(/no invoices yet/i)).not.toBeInTheDocument();
  });

  it('admits partially-omitted rows beside a non-empty list', async () => {
    apiGet.mockResolvedValue({
      data: { invoices: [PAID_ROW], unavailableProviders: [], truncated: false, omittedRows: 2 },
    });
    wrap(<InvoiceHistory />);
    await screen.findByText('$19.00');
    expect(screen.getByText(/Some invoices couldn’t\s+be displayed/i)).toBeInTheDocument();
  });

  it('names each field in the row accessible name, so a due invoice never reads as a bare "Due"', async () => {
    // QA-billing-20260901-07, Codex round 2: the visual column header is
    // decorative (aria-hidden), and an unlabeled a11y-tree value list
    // ("May 1, $19, Due") kept the exact ambiguity the header was meant
    // to fix, in a different form. The accessible name must carry the
    // field names themselves, not just their values.
    apiGet.mockResolvedValue({
      data: {
        invoices: [{ ...PAID_ROW, status: 'due' as const }],
        unavailableProviders: [],
        truncated: false,
        omittedRows: 0,
      },
    });
    wrap(<InvoiceHistory />);
    expect(
      await screen.findByLabelText('Date May 1, 2026, amount $19.00, status Due'),
    ).toBeInTheDocument();
  });

  it('fetches nothing when disabled (billing dark / never subscribed)', () => {
    wrap(<InvoiceHistory enabled={false} />);
    expect(apiGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('invoice-history')).not.toBeInTheDocument();
  });
});

describe('PaymentMethodCard', () => {
  it('offers Paddle the update button', () => {
    wrap(<PaymentMethodCard provider="paddle" isPastDue={false} />);
    expect(screen.getByRole('button', { name: 'Update payment method' })).toBeInTheDocument();
  });

  it('gives Razorpay a support path and NO button whose only outcome is a refusal', () => {
    wrap(<PaymentMethodCard provider="razorpay" isPastDue={false} />);
    expect(screen.queryByRole('button', { name: 'Update payment method' })).not.toBeInTheDocument();
    expect(screen.getByText(/authorized mandate/i)).toBeInTheDocument();
  });

  it('states the dunning consequence on past_due, and names updating as the fix', () => {
    wrap(<PaymentMethodCard provider="paddle" isPastDue />);
    expect(screen.getByText(/didn’t go through/i)).toBeInTheDocument();
    expect(screen.getByText(/restores the plan/i)).toBeInTheDocument();
  });

  it('does not promise a Paddle-style fix to a past_due Razorpay customer', () => {
    wrap(<PaymentMethodCard provider="razorpay" isPastDue />);
    expect(screen.queryByText(/restores the plan/i)).not.toBeInTheDocument();
    expect(screen.getByText(/contact support to update your payment method/i)).toBeInTheDocument();
    expect(screen.queryByText(/stays active while we sort this out/i)).not.toBeInTheDocument();
  });

  it('withholds the control while a money action is unresolved, and says why', () => {
    wrap(
      <PaymentMethodCard
        provider="paddle"
        isPastDue={false}
        disabled
        disabledReason="Available once the payment above finishes confirming."
      />,
    );
    expect(screen.getByRole('button', { name: 'Update payment method' })).toBeDisabled();
    expect(screen.getByText(/finishes confirming/i)).toBeInTheDocument();
  });

  it('renders a paddle refusal with GENERIC copy — the India-mandate claim belongs to Razorpay', async () => {
    // A non-Razorpay rail answering `unsupported` is unexpected, and the
    // mandate sentence is a fact about Razorpay specifically — showing
    // it to a Paddle customer explains the refusal with a fact that
    // isn't one (gate network 2026-08-16).
    apiPost.mockResolvedValue({
      data: { kind: 'unsupported', provider: 'paddle', reason: 'no_self_serve' },
    });
    wrap(<PaymentMethodCard provider="paddle" isPastDue={false} />);
    screen.getByRole('button', { name: 'Update payment method' }).click();
    await waitFor(() =>
      expect(screen.getByText(/can’t be changed from here right now/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/authorized mandate/i)).not.toBeInTheDocument();
    // A 200 "this rail cannot" must not surface as a retryable error.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders a razorpay refusal with the mandate explanation', async () => {
    apiPost.mockResolvedValue({
      data: { kind: 'unsupported', provider: 'razorpay', reason: 'no_self_serve' },
    });
    wrap(<PaymentMethodCard provider="paddle" isPastDue={false} />);
    screen.getByRole('button', { name: 'Update payment method' }).click();
    await waitFor(() => expect(screen.getByText(/authorized mandate/i)).toBeInTheDocument());
  });
});
