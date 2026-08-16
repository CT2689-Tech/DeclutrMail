'use client';

/**
 * D119 / ADR-0035 — the invoice section.
 *
 * Every row is a provider-owned document; we generate none. Paddle's is
 * the legal tax document (it is the merchant of record), so its rows
 * mint a signed PDF per click; Razorpay exposes a stable hosted page, so
 * its rows link straight out.
 *
 * Three honesty rules this component exists to keep:
 *
 *   - A failed read renders as a failed read. "You have no invoices" and
 *     "we could not ask your provider" are different sentences.
 *   - A PARTIAL list says so. A workspace can hold rows under both rails
 *     (a region switch creates a second customer row), and one rail
 *     being down must not silently shorten the history.
 *   - The section renders for a workspace that has CANCELLED, too. The
 *     tax need outlives the subscription, and the commonest reason to
 *     open this page after leaving is to fetch last year's receipts.
 */

import { Button, Eyebrow, ErrorState as RecoverableErrorState, tokens } from '@declutrmail/shared';
import type { BillingInvoice } from '@declutrmail/shared/contracts';

import { formatProviderAmount, formatBillingDate } from './billing-model';
import { useInvoiceDocument } from './api/use-payment-method';
import { useInvoices } from './api/use-invoices';

const { color, radius, shadow } = tokens;

const SECTION_STYLE = {
  background: color.card,
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  boxShadow: shadow.card,
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
} as const;

/** Row status → the word a customer recognizes on a statement. */
function statusLabel(status: BillingInvoice['status']): string | null {
  if (status === 'paid') return 'Paid';
  if (status === 'due') return 'Due';
  if (status === 'canceled') return 'Canceled';
  // `unknown` deliberately renders NOTHING rather than a guess — the
  // provider used a status we do not map, and inventing "Paid" over it
  // is the one error that matters here.
  return null;
}

export function InvoiceHistory({ enabled = true }: { enabled?: boolean }) {
  const invoices = useInvoices({ enabled });
  const document = useInvoiceDocument();

  if (!enabled) return null;

  if (invoices.isLoading) {
    return (
      <section aria-label="Invoices" data-testid="invoice-history" style={SECTION_STYLE}>
        <Eyebrow>Invoices</Eyebrow>
        <div
          aria-hidden="true"
          style={{ height: 72, background: color.paper, borderRadius: radius.md }}
        />
        <span style={{ position: 'absolute', left: -9999 }}>Loading invoices</span>
      </section>
    );
  }

  if (invoices.isError) {
    return (
      <section aria-label="Invoices" data-testid="invoice-history" style={SECTION_STYLE}>
        <Eyebrow>Invoices</Eyebrow>
        <RecoverableErrorState
          title="We couldn't load your invoices"
          description="Your payment provider didn't answer. Your plan and your billing are unaffected — this page only reads them."
          onRetry={() => invoices.refetch()}
        />
      </section>
    );
  }

  const data = invoices.data;
  if (!data) return null;
  const partial = data.unavailableProviders.length > 0;

  return (
    <section aria-label="Invoices" data-testid="invoice-history" style={SECTION_STYLE}>
      <Eyebrow>Invoices</Eyebrow>

      {data.invoices.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: color.fgSoft }}>
          {partial
            ? // NOT "no invoices": the one rail that could have had them
              // is exactly the one we failed to read.
              'We couldn’t reach your payment provider, so we can’t show your invoices right now.'
            : 'No invoices yet. Your first one appears here once a payment has been collected.'}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
          {data.invoices.map((invoice) => {
            const amount = formatProviderAmount(invoice.amount, invoice.currencyCode);
            const date = formatBillingDate(invoice.issuedAt);
            const label = statusLabel(invoice.status);
            const busy = document.isPending && document.variables === invoice.id;
            return (
              <li
                key={`${invoice.provider}:${invoice.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                  padding: '10px 0',
                  borderBottom: `1px solid ${color.lineSoft}`,
                  fontSize: 13,
                }}
              >
                <span style={{ color: color.fg, minWidth: 120 }}>{date ?? '—'}</span>
                <span
                  style={{
                    color: color.fg,
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: 90,
                  }}
                >
                  {/* An unformattable amount shows the currency and no
                      number rather than a wrong one (never-fabricate). */}
                  {amount ?? invoice.currencyCode}
                </span>
                {label ? (
                  <span style={{ color: color.fgMuted, minWidth: 70 }}>{label}</span>
                ) : (
                  <span style={{ minWidth: 70 }} />
                )}
                <span style={{ marginLeft: 'auto' }}>
                  {invoice.hostedUrl ? (
                    <a
                      href={invoice.hostedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: color.primary }}
                    >
                      View invoice
                    </a>
                  ) : invoice.documentAvailable ? (
                    <Button
                      tone="default"
                      disabled={document.isPending}
                      onClick={() => document.mutate(invoice.id)}
                    >
                      {busy ? 'Preparing…' : 'Download'}
                    </Button>
                  ) : (
                    // Neither a hosted page nor a mintable document —
                    // say nothing is available rather than render a
                    // control that cannot work.
                    <span style={{ color: color.fgMuted, fontSize: 12 }}>No document</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {partial && data.invoices.length > 0 ? (
        <p role="status" style={{ margin: 0, fontSize: 12, color: color.amber }}>
          One of your payment providers didn&rsquo;t answer, so this list may be missing invoices.
          Reload to try again.
        </p>
      ) : null}

      {data.truncated ? (
        <p style={{ margin: 0, fontSize: 12, color: color.fgMuted }}>
          Showing your most recent invoices. Email support@declutrmail.com if you need older ones.
        </p>
      ) : null}

      {document.error ? (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: color.red,
            background: 'rgba(239,68,68,0.08)',
            border: `1px solid ${color.red}`,
            borderRadius: 8,
            padding: '8px 10px',
          }}
        >
          That invoice couldn&rsquo;t be opened. Nothing about your plan or billing changed — try
          again, or email support@declutrmail.com.
        </div>
      ) : null}
    </section>
  );
}
