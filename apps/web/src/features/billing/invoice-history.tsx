'use client';

import { CleanupSelect } from '@/components/cleanup-select';
import linkStyles from './billing-links.module.css';

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

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  Button,
  EmptyState,
  ErrorState as RecoverableErrorState,
  tokens,
  useIsAtMost,
} from '@declutrmail/shared';
import type { BillingInvoice } from '@declutrmail/shared/contracts';

import { SERVER_STREAM_PLACEHOLDER } from '@/lib/query-hydration-boundary';

import { formatProviderAmount, formatBillingDate } from './billing-model';
import { billingKeys } from './api/query-keys';
import { useInvoiceDocument, useInvoices } from './api/use-invoices';
import { GroupTitle } from '@/features/settings/settings-list';

const { color, radius, text } = tokens;
/** Rows above which the status and year filters appear. */
const FILTER_AFTER = 5;

const FILTER_STYLE = {
  background: color.card,
  color: color.fg,
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  padding: '6px 8px',
  minHeight: 36,
  maxWidth: '100%',
  minWidth: 0,
  width: '100%',
  boxSizing: 'border-box',
} as const;

const SECTION_STYLE = {
  scrollMarginTop: 24,
  background: color.card,
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  padding: 'clamp(16px, 3vw, 22px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
} as const;

/**
 * Row status → the word a customer recognizes on a statement.
 * Exhaustive over the contract enum, so a new member is a type error
 * here rather than a silent fall-through. `unknown` deliberately maps
 * to NOTHING rather than a guess — the provider used a status we do not
 * map, and inventing "Paid" over it is the one error that matters here.
 */
const STATUS_LABEL = {
  paid: 'Paid',
  due: 'Due',
  canceled: 'Canceled',
  unknown: null,
  refunded: 'Refunded',
  partially_refunded: 'Partially refunded',
} as const;

function invoiceStatus(invoice: BillingInvoice): keyof typeof STATUS_LABEL {
  const refund = invoice.refundedAmount;
  if (
    invoice.status !== 'paid' ||
    !refund ||
    !/^\d+$/.test(refund) ||
    !/^\d+$/.test(invoice.amount)
  )
    return invoice.status;
  const returned = BigInt(refund);
  const original = BigInt(invoice.amount);
  if (returned > original) return 'unknown';
  if (returned === 0n) return invoice.status;
  return returned === original ? 'refunded' : 'partially_refunded';
}

export function InvoiceHistory({ enabled = true }: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  // Read before useInvoices: mounting the observer replaces query options
  // and drops this meta. The flag means the server flushed the skeleton
  // while the invoice read was still streaming. The resolved payload can
  // already be in the cache at hydration, and painting it then is a
  // different tree from that skeleton (React #418).
  const [holdStreamPlaceholder] = useState(
    () =>
      queryClient.getQueryCache().find({ queryKey: billingKeys.invoices() })?.meta?.[
        SERVER_STREAM_PLACEHOLDER
      ] === true,
  );
  const [streamRevealed, setStreamRevealed] = useState(false);
  useEffect(() => {
    setStreamRevealed(true);
  }, []);
  const invoices = useInvoices({ enabled });
  const mint = useInvoiceDocument();
  const isPhone = useIsAtMost('xs');
  const [status, setStatus] = useState('all');
  const [year, setYear] = useState('');

  if (!enabled) return null;

  if ((holdStreamPlaceholder && !streamRevealed) || invoices.isLoading) {
    return (
      <section
        id="invoices"
        tabIndex={-1}
        aria-label="Payment history"
        data-testid="invoice-history"
        style={SECTION_STYLE}
      >
        <GroupTitle>Payment history</GroupTitle>
        <div
          aria-hidden="true"
          style={{ height: 72, background: color.fill, borderRadius: radius.lg }}
        />
        <span style={{ position: 'absolute', left: -9999 }}>Loading invoices…</span>
      </section>
    );
  }

  if (invoices.isError) {
    return (
      <section
        id="invoices"
        tabIndex={-1}
        aria-label="Payment history"
        data-testid="invoice-history"
        style={SECTION_STYLE}
      >
        <GroupTitle>Payment history</GroupTitle>
        <RecoverableErrorState
          headingLevel={3}
          title="We couldn’t load your invoices"
          description="Try again to load your invoices."
          onRetry={() => invoices.refetch()}
        />
      </section>
    );
  }

  const data = invoices.data;
  if (!data) return null;
  const partial = data.unavailableProviders.length > 0;
  // Compact only a complete, successfully read empty history. An unavailable,
  // omitted or truncated result is still a recovery state, never "no invoices".
  // A complete, successfully read empty history has nothing to show, so
  // the section stays out of the way — above all on a Free account deciding
  // what to buy. Unavailable, omitted or truncated reads still render below:
  // those are recovery states, never "no invoices".
  if (data.invoices.length === 0 && !partial && data.omittedRows === 0 && !data.truncated) {
    return null;
  }
  const filtered = data.invoices.filter(
    (invoice) =>
      (status === 'all' || status === invoiceStatus(invoice)) &&
      (!year || invoice.issuedAt.startsWith(year)),
  );
  // Filters earn their space once the list is long — or capped, since a
  // capped read means more history exists than loaded. Receipts are
  // looked up by tax year, so a year beats a from/through date range.
  const filterable = data.invoices.length > FILTER_AFTER || data.truncated;
  const years = [...new Set(data.invoices.map((invoice) => invoice.issuedAt.slice(0, 4)))].sort(
    (a, b) => b.localeCompare(a),
  );

  return (
    <section
      id="invoices"
      tabIndex={-1}
      aria-label="Payment history"
      data-testid="invoice-history"
      style={SECTION_STYLE}
    >
      <GroupTitle>Payment history</GroupTitle>
      <p style={{ margin: 0, color: color.fgMuted, fontSize: text.sm }}>
        Payments and invoices from past subscriptions and one-time purchases.
      </p>
      {filterable ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, flex: '1 1 145px', minWidth: 0 }}>
              Status{' '}
              <CleanupSelect
                name="invoice-status"
                autoComplete="off"
                style={FILTER_STYLE}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="paid">Paid invoices</option>
                <option value="refunded">Refunded invoices</option>
                <option value="partially_refunded">Partially refunded invoices</option>
                <option value="due">Due invoices</option>
                <option value="canceled">Canceled invoices</option>
                <option value="unknown">Unknown status</option>
              </CleanupSelect>
            </label>
            <label style={{ display: 'grid', gap: 6, flex: '1 1 145px', minWidth: 0 }}>
              Year{' '}
              <CleanupSelect
                name="invoice-year"
                autoComplete="off"
                style={FILTER_STYLE}
                value={year}
                onChange={(event) => setYear(event.target.value)}
              >
                <option value="">All years</option>
                {years.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </CleanupSelect>
            </label>
            {status !== 'all' || year ? (
              <Button
                size="sm"
                onClick={() => {
                  setStatus('all');
                  setYear('');
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
          <p role="status" style={{ margin: 0, color: color.fgMuted, fontSize: text.sm }}>
            {filtered.length} of {data.invoices.length} loaded invoices. Filters apply to this
            loaded history only.
          </p>
          {filtered.length === 0 ? <p>No loaded invoices match these filters.</p> : null}
        </>
      ) : null}

      {data.invoices.length === 0 ? (
        // Failed, omitted and capped reads cannot prove an account never paid.
        // Only a complete empty history can show "No invoices yet".
        partial ? (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}
          >
            <p style={{ margin: 0, fontSize: text.md, color: color.fgSoft }}>
              Your payment provider didn&rsquo;t return your invoices.
            </p>
            <Button
              tone="default"
              size="sm"
              disabled={invoices.isFetching}
              onClick={() => void invoices.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : data.omittedRows > 0 ? (
          <p role="status" style={{ margin: 0, fontSize: text.md, color: color.amber }}>
            We couldn&rsquo;t display this billing history. Email{' '}
            <a href="mailto:support@declutrmail.com" style={{ color: color.primary }}>
              support@declutrmail.com
            </a>{' '}
            for help with your invoices.
          </p>
        ) : data.truncated ? (
          <EmptyState
            headingLevel={3}
            title="No invoices in this limited history"
            description="Request older invoices below to check beyond this list."
          />
        ) : null
      ) : (
        <>
          {/* QA-billing-20260901-07: with no column labels, "Due" on the
              top row reads as "you owe this", immediately above rows
              marked Paid — a header turns an alarm into a status. Phone
              rows already stack vertically (each field labels itself via
              layout order), so the header only helps at desktop width. */}
          {!isPhone ? (
            <div
              aria-hidden="true"
              style={{
                display: 'flex',
                gap: 12,
                padding: '0 0 4px',
                fontSize: text.xs,
                fontWeight: 600,
                color: color.fgMuted,
              }}
            >
              <span style={{ minWidth: 120 }}>Date</span>
              <span style={{ minWidth: 90 }}>Amount</span>
              <span style={{ minWidth: 70 }}>Status</span>
              <span style={{ marginLeft: 'auto' }}>Invoice</span>
            </div>
          ) : null}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
            {filtered.map((invoice) => {
              const amount = formatProviderAmount(invoice.amount, invoice.currencyCode);
              const date = formatBillingDate(invoice.issuedAt);
              const displayStatus = invoiceStatus(invoice);
              const label = STATUS_LABEL[displayStatus];
              const refundAmount = invoice.refundedAmount
                ? formatProviderAmount(invoice.refundedAmount, invoice.currencyCode)
                : null;
              const busy = mint.isPending && mint.variables === invoice.id;
              // Codex round 1 (QA-billing-20260901-07): the new header
              // row is `aria-hidden` (decorative, sighted-only), so a
              // screen-reader user got the same unlabeled date/amount/
              // status/document sequence as before — worse, since the
              // header now visually implies a relationship the a11y
              // tree still doesn't carry. State it directly on the row.
              // Codex round 2: raw values alone ("May 1, $19, Due") kept
              // the same ambiguity in a different form — "Due" still
              // reads as an amount owed without the field name in front
              // of it. Name each field.
              const rowLabel = `Date ${date ?? 'unknown'}, amount ${
                amount ?? invoice.currencyCode
              }, status ${label ?? 'unknown'}${
                (displayStatus === 'refunded' || displayStatus === 'partially_refunded') &&
                refundAmount
                  ? `, refunded ${refundAmount}`
                  : ''
              }`;
              return (
                <li
                  key={`${invoice.provider}:${invoice.id}`}
                  aria-label={rowLabel}
                  style={{
                    display: 'flex',
                    flexDirection: isPhone ? 'column' : 'row',
                    alignItems: isPhone ? 'flex-start' : 'center',
                    gap: isPhone ? 6 : 12,
                    flexWrap: 'wrap',
                    minHeight: 52,
                    boxSizing: 'border-box',
                    padding: '10px 0',
                    borderBottom: `1px solid ${color.lineSoft}`,
                    fontSize: text.md,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      color: color.fg,
                      fontWeight: 500,
                      fontVariantNumeric: 'tabular-nums',
                      minWidth: isPhone ? 0 : 120,
                    }}
                  >
                    {date ?? '—'}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      color: color.fg,
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                      minWidth: isPhone ? 0 : 90,
                    }}
                  >
                    {/* An unformattable amount shows the currency and no
                      number rather than a wrong one (never-fabricate). */}
                    {amount ?? invoice.currencyCode}
                  </span>
                  {label ? (
                    <span
                      aria-hidden="true"
                      style={{ color: color.fgMuted, minWidth: isPhone ? 0 : 70 }}
                    >
                      {label}
                      {displayStatus === 'partially_refunded' && refundAmount ? (
                        <span style={{ display: 'block', fontSize: text.sm }}>
                          {refundAmount} refunded
                        </span>
                      ) : null}
                    </span>
                  ) : isPhone ? null : (
                    <span aria-hidden="true" style={{ minWidth: 70 }} />
                  )}
                  <span style={{ marginLeft: isPhone ? 0 : 'auto' }}>
                    {invoice.hostedUrl ? (
                      <a
                        className={linkStyles.link}
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
                        size="sm"
                        disabled={mint.isPending}
                        onClick={() => mint.mutate(invoice.id)}
                      >
                        {busy ? 'Preparing…' : 'Download'}
                      </Button>
                    ) : (
                      // Neither a hosted page nor a mintable document —
                      // say nothing is available rather than render a
                      // control that cannot work.
                      <span style={{ color: color.fgMuted, fontSize: text.sm }}>No document</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {partial && data.invoices.length > 0 ? (
        <p role="status" style={{ margin: 0, fontSize: text.sm, color: color.amber }}>
          Some payment history couldn&rsquo;t be loaded, so this list may be missing invoices.
          Reload to try again.
        </p>
      ) : null}

      {data.omittedRows > 0 && data.invoices.length > 0 ? (
        <p role="status" style={{ margin: 0, fontSize: text.sm, color: color.amber }}>
          Some invoices couldn&rsquo;t be displayed. Email support@declutrmail.com if you need them.
        </p>
      ) : null}

      {data.truncated ? (
        <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
          This list shows a limited invoice history.{' '}
          <a
            className={linkStyles.link}
            href="mailto:support@declutrmail.com?subject=Older%20invoice%20request"
          >
            Request older invoices
          </a>
          .
        </p>
      ) : null}

      {mint.error ? (
        <div
          role="alert"
          style={{
            fontSize: text.sm,
            color: color.dangerText,
            background: color.dangerBg,
            borderRadius: radius.md,
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
