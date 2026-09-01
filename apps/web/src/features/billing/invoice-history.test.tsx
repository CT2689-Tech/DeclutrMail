/**
 * Tests for the D119 / ADR-0035 billing-artifact sections.
 *
 * The cases that matter here are the honesty ones, not the happy path:
 * a failed read must not read as "no invoices", a partial list must say
 * it is partial, an unmappable status must not be rounded to "Paid",
 * and Razorpay must never render a payment-method button whose only
 * outcome is a refusal.
 */

import { render, screen, waitFor } from '@testing-library/react';
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
  it('renders a paid row with its formatted amount and a download control', async () => {
    apiGet.mockResolvedValue({
      data: { invoices: [PAID_ROW], unavailableProviders: [], truncated: false, omittedRows: 0 },
    });
    wrap(<InvoiceHistory />);
    expect(await screen.findByText('$19.00')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('shows a real error state — never an empty list — when the read fails', async () => {
    apiGet.mockRejectedValue(new Error('boom'));
    wrap(<InvoiceHistory />);
    expect(await screen.findByText(/couldn't load your invoices/i)).toBeInTheDocument();
    expect(screen.queryByText(/no invoices yet/i)).not.toBeInTheDocument();
  });

  it('does not claim "no invoices" when the only rail we could ask was unreachable', async () => {
    apiGet.mockResolvedValue({
      data: { invoices: [], unavailableProviders: ['paddle'], truncated: false, omittedRows: 0 },
    });
    wrap(<InvoiceHistory />);
    expect(await screen.findByText(/couldn’t reach your payment provider/i)).toBeInTheDocument();
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
    expect(await screen.findByText(/most recent invoices/i)).toBeInTheDocument();
  });

  it('never claims "no invoices yet" when rows exist but none were renderable', async () => {
    // The all-rows-dropped shape: the provider answered, every row was
    // unrenderable (wrong field names would do exactly this), and the
    // customer DOES have invoices (gate network 2026-08-16, CONFIRMED).
    apiGet.mockResolvedValue({
      data: { invoices: [], unavailableProviders: [], truncated: false, omittedRows: 4 },
    });
    wrap(<InvoiceHistory />);
    expect(await screen.findByText(/your invoices exist/i)).toBeInTheDocument();
    expect(screen.queryByText(/no invoices yet/i)).not.toBeInTheDocument();
  });

  it('admits partially-omitted rows beside a non-empty list', async () => {
    apiGet.mockResolvedValue({
      data: { invoices: [PAID_ROW], unavailableProviders: [], truncated: false, omittedRows: 2 },
    });
    wrap(<InvoiceHistory />);
    await screen.findByText('$19.00');
    expect(screen.getByText(/2 invoices couldn’t\s+be displayed/i)).toBeInTheDocument();
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
    expect(screen.getByText(/stays active while we sort this out/i)).toBeInTheDocument();
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
