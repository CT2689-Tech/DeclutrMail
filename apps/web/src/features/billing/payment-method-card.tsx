'use client';

/**
 * D119 / ADR-0035 — the payment-method section.
 *
 * We hold no card data and never will: Paddle is the merchant of record
 * and owns the instrument, so this section's entire job is to get the
 * customer to Paddle's own hosted form. It therefore shows no brand, no
 * last four and no expiry — displaying them would mean reading and
 * caching instrument details we have deliberately chosen not to keep.
 *
 * Razorpay has no self-serve path at all (a subscription there is
 * collected against an authorized mandate), so that rail renders
 * support-assisted copy rather than a button whose only outcome is a
 * refusal — the same shape Razorpay pause and resume already use.
 *
 * `past_due` is why this exists. Before it, both dunning notices told
 * the customer to "update your payment method with the provider" and
 * linked nowhere, on the one status where not acting ends the plan.
 */

import { useState } from 'react';

import { Button, tokens } from '@declutrmail/shared';
import type { BillingProviderId } from '@declutrmail/shared/contracts';

import { usePaymentMethodSession } from './api/use-payment-method';
import { GroupTitle } from '@/features/settings/settings-list';

const { color, radius, shadow, text } = tokens;

export function PaymentMethodCard({
  provider,
  isPastDue,
  disabled = false,
  disabledReason = null,
}: {
  /** The rail funding the granting subscription. */
  provider: BillingProviderId;
  /** Dunning — this section becomes the screen's primary action. */
  isPastDue: boolean;
  /**
   * Withheld while a money action is unresolved. The portal can start a
   * payment, and the screen already refuses to arm two money paths at
   * once (the double-charge lock this page is built around).
   */
  disabled?: boolean;
  disabledReason?: string | null;
}) {
  const session = usePaymentMethodSession();
  // The resolved `unsupported` answer, kept so the refusal renders as a
  // fact rather than as an error. It is a 200: the rail cannot do this,
  // which is not something a retry fixes. The REFUSING provider is kept
  // with it — the India-mandate explanation is a claim about Razorpay,
  // and rendering it over another rail's refusal would explain the
  // refusal with a fact that isn't one (gate network 2026-08-16).
  const [refusedBy, setRefusedBy] = useState<BillingProviderId | null>(null);
  const supportProvider = provider === 'razorpay' ? 'razorpay' : refusedBy;
  const showSupportPath = supportProvider !== null;
  const mandateExplains = supportProvider === 'razorpay';

  return (
    <section
      aria-label="Payment method"
      data-testid="payment-method-card"
      style={{
        background: color.card,
        // Past due is said in amber lettering below; the ring only marks
        // which surface needs attention.
        boxShadow: isPastDue ? `0 0 0 2px ${color.amber}, ${shadow.card}` : shadow.card,
        borderRadius: radius.xl,
        padding: 'clamp(20px, 4vw, 28px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <GroupTitle as="div">Payment method</GroupTitle>

      <p style={{ margin: 0, fontSize: text.md, lineHeight: 1.55, color: color.fgMuted }}>
        {showSupportPath ? (
          mandateExplains ? (
            <>
              Subscriptions billed in India are collected against an authorized mandate, so the card
              can&rsquo;t be changed from here. Email{' '}
              <a href="mailto:support@declutrmail.com" style={{ color: color.primary }}>
                support@declutrmail.com
              </a>{' '}
              and we&rsquo;ll send you a link to re-authorize it.
            </>
          ) : (
            // A non-Razorpay rail answered `unsupported` — a state we
            // don't expect, so no mechanism is claimed for it. Only the
            // support path itself is asserted.
            <>
              Your payment method can&rsquo;t be changed from here right now. Email{' '}
              <a href="mailto:support@declutrmail.com" style={{ color: color.primary }}>
                support@declutrmail.com
              </a>{' '}
              and we&rsquo;ll sort it out with you.
            </>
          )
        ) : (
          <>
            Your card is held by Paddle, our payment provider — we never see or store it. Updating
            it opens Paddle&rsquo;s secure form, and you&rsquo;ll come back here afterwards.
          </>
        )}
      </p>

      {isPastDue ? (
        <p
          role="status"
          style={{ margin: 0, fontSize: text.sm, lineHeight: 1.5, color: color.amber }}
        >
          <strong style={{ fontWeight: 600 }}>Your last payment didn&rsquo;t go through.</strong>{' '}
          {showSupportPath
            ? 'Your plan stays active while we sort this out with you.'
            : 'Updating your card is what restores the plan — the provider retries automatically once it succeeds.'}
        </p>
      ) : null}

      {!showSupportPath ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              tone={isPastDue ? 'primary' : 'default'}
              disabled={disabled || session.isPending}
              onClick={() =>
                session.mutate(undefined, {
                  onSuccess: (result) => {
                    // `url` navigates inside the hook. Only the refusal
                    // needs local state — and reaching it here means the
                    // rail changed under us, so tell the truth rather
                    // than leaving a button that did nothing.
                    if (result.kind === 'unsupported') setRefusedBy(result.provider);
                  },
                })
              }
            >
              {session.isPending ? 'Opening…' : 'Update payment method'}
            </Button>
          </div>
          {disabled && disabledReason ? (
            <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>{disabledReason}</p>
          ) : null}
          {session.error ? (
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
              We couldn&rsquo;t open the payment form. Nothing was charged and your card is
              unchanged. Try again, or email support@declutrmail.com.
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
