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
 * `past_due` is why this exists. Before it, both dunning notices told
 * the customer to "update your payment method with the provider" and
 * linked nowhere, on the one status where not acting ends the plan.
 */

import { Button, tokens } from '@declutrmail/shared';

import { usePaymentMethodSession } from './api/use-payment-method';
import { SettingsGroup, SettingsRow } from '@/features/settings/settings-list';

const { color, radius, text } = tokens;

export function PaymentMethodCard({
  isPastDue,
  disabled = false,
  disabledReason = null,
}: {
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

  return (
    <SettingsGroup testId="payment-method-card" id="payment" title="Payment method">
      <SettingsRow label="Managed by Paddle">
        <Button
          tone={isPastDue ? 'primary' : 'default'}
          disabled={disabled || session.isPending}
          onClick={() => session.mutate()}
        >
          {session.isPending ? 'Opening…' : 'Update payment method'}
        </Button>
      </SettingsRow>
      {isPastDue || (disabled && disabledReason) || session.error ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 16px 16px' }}>
          {isPastDue ? (
            <p
              role="status"
              style={{ margin: 0, fontSize: text.sm, lineHeight: 1.5, color: color.amber }}
            >
              <strong style={{ fontWeight: 600 }}>
                Your last payment didn&rsquo;t go through.
              </strong>{' '}
              Updating your card is what restores the plan — the provider retries automatically once
              it succeeds.
            </p>
          ) : null}
          {disabled && disabledReason ? (
            <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>{disabledReason}</p>
          ) : null}
          {session.error ? (
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
              We couldn&rsquo;t open the payment form. Nothing was charged and your card is
              unchanged. Try again, or email support@declutrmail.com.
            </div>
          ) : null}
        </div>
      ) : null}
    </SettingsGroup>
  );
}
