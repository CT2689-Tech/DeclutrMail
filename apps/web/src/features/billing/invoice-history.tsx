'use client';

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

import { useState } from 'react';

import {
  Button,
  EmptyState,
  ErrorState as RecoverableErrorState,
  tokens,
  useIsAtMost,
} from '@declutrmail/shared';
import type { BillingInvoice } from '@declutrmail/shared/contracts';

import { formatProviderAmount, formatBillingDate } from './billing-model';
import { useInvoiceDocument, useInvoices } from './api/use-invoices';
import { GroupTitle } from '@/features/settings/settings-list';

const { color, radius, text } = tokens;
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
  background: color.card,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
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
const STATUS_LABEL: Record<BillingInvoice['status'], string | null> = {
  paid: 'Paid',
  due: 'Due',
  canceled: 'Canceled',
  unknown: null,
};

export function InvoiceHistory({ enabled = true }: { enabled?: boolean }) {
  const invoices = useInvoices({ enabled });
  const mint = useInvoiceDocument();
  const isPhone = useIsAtMost('xs');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  if (!enabled) return null;

  if (invoices.isLoading) {
    return (
      <section aria-label="Invoices" data-testid="invoice-history" style={SECTION_STYLE}>
        <GroupTitle as="div">Invoices</GroupTitle>
        <div
          aria-hidden="true"
          style={{ height: 72, background: color.fill, borderRadius: radius.lg }}
        />
        <span style={{ position: 'absolute', left: -9999 }}>Loading invoices</span>
      </section>
    );
  }

  if (invoices.isError) {
    return (
      <section aria-label="Invoices" data-testid="invoice-history" style={SECTION_STYLE}>
        <GroupTitle as="div">Invoices</GroupTitle>
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
  const filtered = data.invoices.filter((invoice) => {
    const date = invoice.issuedAt.slice(0, 10);
    return (
      (status === 'all' || status === invoice.status) &&
      (!from || date >= from) &&
      (!to || date <= to)
    );
  });

  return (
    <section aria-label="Invoices" data-testid="invoice-history" style={SECTION_STYLE}>
      <GroupTitle as="div">Invoices</GroupTitle>
      {data.invoices.length > 0 ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, flex: '1 1 145px', minWidth: 0 }}>
              Status{' '}
              <select
                style={FILTER_STYLE}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="paid">Paid invoices</option>
                <option value="due">Due invoices</option>
                <option value="canceled">Canceled invoices</option>
                <option value="unknown">Unknown status</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 6, flex: '1 1 145px', minWidth: 0 }}>
              From{' '}
              <input
                type="date"
                style={FILTER_STYLE}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 6, flex: '1 1 145px', minWidth: 0 }}>
              Through{' '}
              <input
                type="date"
                style={FILTER_STYLE}
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
            {status !== 'all' || from || to ? (
              <Button
                size="sm"
                onClick={() => {
                  setStatus('all');
                  setFrom('');
                  setTo('');
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
        // THREE distinct empty answers, never collapsed: a rail we could
        // not ask (partial), rows that exist but none renderable
        // (omitted — with wrong field names EVERY row drops, and calling
        // that "no invoices yet" is the failed-read-as-empty defect,
        // gate network 2026-08-16 CONFIRMED), and the genuine
        // never-billed state (D212 EmptyState primitive).
        partial ? (
          <p style={{ margin: 0, fontSize: text.md, color: color.fgSoft }}>
            We couldn&rsquo;t reach your payment provider, so we can&rsquo;t show your invoices
            right now.
          </p>
        ) : data.omittedRows > 0 ? (
          <p role="status" style={{ margin: 0, fontSize: text.md, color: color.amber }}>
            Your invoices exist, but we couldn&rsquo;t display them. Email{' '}
            <a href="mailto:support@declutrmail.com" style={{ color: color.primary }}>
              support@declutrmail.com
            </a>{' '}
            and we&rsquo;ll send them to you directly.
          </p>
        ) : (
          <EmptyState
            title="No invoices yet"
            description="Your first one appears here once a payment has been collected."
          />
        )
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
              const label = STATUS_LABEL[invoice.status];
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
              }, status ${label ?? 'unknown'}`;
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
          One of your payment providers didn&rsquo;t answer, so this list may be missing invoices.
          Reload to try again.
        </p>
      ) : null}

      {data.omittedRows > 0 && data.invoices.length > 0 ? (
        <p role="status" style={{ margin: 0, fontSize: text.sm, color: color.amber }}>
          {data.omittedRows === 1 ? 'One invoice' : `${data.omittedRows} invoices`} couldn&rsquo;t
          be displayed. Email support@declutrmail.com if you need{' '}
          {data.omittedRows === 1 ? 'it' : 'them'}.
        </p>
      ) : null}

      {data.truncated ? (
        <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
          Showing your most recent invoices.{' '}
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
            color: color.danger,
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
