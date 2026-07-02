// Refund Policy (D146) — public, static, no client JS.
//
// Required by both payment providers (D117): Paddle (merchant of
// record outside India) and Razorpay (India) each require a published
// refund/cancellation policy.
//
// FOUNDER-REVIEW-GATED: the 14-day pro-rata window is a recommended
// default and is explicitly flagged for founder confirmation in the
// PR before merge.

import type { Metadata } from 'next';
import { LegalPageLayout, LegalSection, LegalNote } from '@/features/marketing/legal-layout';

export const metadata: Metadata = {
  title: 'Refund Policy — DeclutrMail',
  description:
    'How refunds and cancellations work for DeclutrMail subscriptions, whether you purchased through Paddle (global) or Razorpay (India).',
};

const LAST_UPDATED = '2026-06-11';

const TOC = [
  { id: 'summary', label: 'The short version' },
  { id: 'cancellation', label: 'Cancellation' },
  { id: 'refund-window', label: 'Refund window' },
  { id: 'paddle', label: 'Purchases outside India (Paddle)' },
  { id: 'razorpay', label: 'Purchases in India (Razorpay)' },
  { id: 'exclusions', label: 'What is not refundable' },
  { id: 'how-to-request', label: 'How to request a refund' },
] as const;

export default function RefundPolicyPage() {
  return (
    <LegalPageLayout title="Refund Policy" lastUpdated={LAST_UPDATED} toc={TOC}>
      <LegalSection id="summary" title="1. The short version">
        <p>
          If DeclutrMail isn&rsquo;t working out, tell us within 14 days of being charged and we
          will refund the unused portion of your subscription. You can cancel anytime and keep
          access until the end of the period you paid for. Refunds go back to your original payment
          method.
        </p>
      </LegalSection>

      <LegalSection id="cancellation" title="2. Cancellation">
        <p>
          You can cancel your subscription at any time from Settings → Billing. Cancellation stops
          future renewals; your paid features stay active until the end of the current billing
          period, after which your account moves to the Free plan. Canceling does not delete any of
          your data.
        </p>
      </LegalSection>

      <LegalSection id="refund-window" title="3. Refund window">
        <LegalNote>
          <p style={{ margin: 0 }}>
            <strong>Pending confirmation:</strong> the window and pro-rata terms below are a
            recommended default and are under review. They may change before they are final.
          </p>
        </LegalNote>
        <p>
          Refund requests made within <strong>14 days</strong> of a charge — your first purchase or
          a renewal — are honored on a <strong>pro-rata basis</strong>: we refund the value of the
          remaining, unused part of the billing period from the date your request is received. If
          you request a refund within 14 days of your very first purchase and have barely used the
          service, we will simply refund the charge in full.
        </p>
        <p>
          This applies to all paid plans, monthly and annual, including the Founding Pro annual
          offer. Statutory refund rights in your country (for example, EU consumer withdrawal
          rights) are not limited by this policy.
        </p>
      </LegalSection>

      <LegalSection id="paddle" title="4. Purchases outside India (Paddle)">
        <p>
          If you purchased outside India, your payment was processed by <strong>Paddle</strong>, our
          merchant of record — Paddle is the seller of record for the transaction, and{' '}
          <a href="https://www.paddle.com/legal/checkout-buyer-terms" rel="noopener noreferrer">
            Paddle&rsquo;s buyer terms
          </a>{' '}
          apply to it. You can request a refund either from us directly (
          <a href="mailto:support@declutrmail.com">support@declutrmail.com</a>) or from Paddle via
          the receipt email they sent you; either path reaches the same outcome, and we instruct
          Paddle to process refunds consistent with this policy.
        </p>
      </LegalSection>

      <LegalSection id="razorpay" title="5. Purchases in India (Razorpay)">
        <p>
          If you purchased in India, your payment was processed by <strong>Razorpay</strong> and
          DeclutrMail is your seller. Request a refund from us at{' '}
          <a href="mailto:support@declutrmail.com">support@declutrmail.com</a>; approved refunds are
          issued through Razorpay to your original payment method (UPI, card, or netbanking).
          Razorpay typically settles refunds within 5–7 business days of processing, depending on
          your bank.
        </p>
      </LegalSection>

      <LegalSection id="exclusions" title="6. What is not refundable">
        <ul>
          <li>Charges older than the refund window in Section 3, except where law requires.</li>
          <li>
            Periods already consumed — refunds are calculated on the unused remainder of the billing
            period.
          </li>
          <li>
            Accounts terminated for violating our <a href="/terms">Terms of Service</a> (abuse,
            unlawful use).
          </li>
        </ul>
        <p>
          One thing a refund never affects: your mailbox. Actions DeclutrMail performed remain
          reversible for their full undo window regardless of your billing state, and your data
          stays exportable and deletable per the <a href="/privacy">Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection id="how-to-request" title="7. How to request a refund">
        <p>
          Email <a href="mailto:support@declutrmail.com">support@declutrmail.com</a> from the
          address on your DeclutrMail account, with the word &ldquo;refund&rdquo; in the subject. No
          questionnaire, no retention flow — we will confirm within 2 business days and tell you the
          exact amount and when to expect it.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
