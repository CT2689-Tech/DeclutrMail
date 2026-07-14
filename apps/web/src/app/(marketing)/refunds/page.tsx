// Refund Policy (D146) — public, static prose; the only client JS is
// the D159 page-view tracker island.
//
// Required by both payment providers (D117): Paddle (merchant of
// record outside India) and Razorpay (India) each require a published
// refund/cancellation policy.
//
// FOUNDER-CONFIRMED 2026-07-08 (D121): 30-day money-back guarantee on
// every paid plan, with a fair-use clause (one guarantee use per
// customer; bulk-consume-then-refund may be declined). This replaced
// the interim 14-day pro-rata default.

import type { Metadata } from 'next';
import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Refund Policy — DeclutrMail',
  description:
    'How refunds and cancellations work for DeclutrMail subscriptions, whether you purchased through Paddle (global) or Razorpay (India).',
  path: '/refunds',
});

const LAST_UPDATED = '2026-07-14';

const TOC = [
  { id: 'summary', label: 'The short version' },
  { id: 'cancellation', label: 'Cancellation' },
  { id: 'refund-window', label: '30-day money-back guarantee' },
  { id: 'paddle', label: 'Purchases outside India (Paddle)' },
  { id: 'razorpay', label: 'Purchases in India (Razorpay)' },
  { id: 'exclusions', label: 'What is not refundable' },
  { id: 'how-to-request', label: 'How to request a refund' },
] as const;

export default function RefundPolicyPage() {
  return (
    <LegalPageLayout title="Refund Policy" lastUpdated={LAST_UPDATED} toc={TOC}>
      <PageViewTracker page="refunds" />
      <LegalSection id="summary" title="1. The short version">
        <p>
          Every paid plan comes with a <strong>30-day money-back guarantee</strong>. If DeclutrMail
          isn&rsquo;t working out, tell us within 30 days of being charged and we will refund the
          charge in full. You can cancel anytime and keep access until the end of the period you
          paid for. Refunds go back to your original payment method.
        </p>
      </LegalSection>

      <LegalSection id="cancellation" title="2. Cancellation">
        <p>
          You can cancel your subscription at any time from Settings → Billing. Cancellation stops
          future renewals; your paid features stay active until the end of the current billing
          period, after which your account moves to the Free plan. Canceling does not delete any of
          your data. Cancellation on its own does not trigger a refund — if you also want your money
          back, the 30-day guarantee in Section 3 covers it.
        </p>
      </LegalSection>

      <LegalSection id="refund-window" title="3. 30-day money-back guarantee">
        <p>
          Refund requests made within <strong>30 days</strong> of a charge — your first purchase or
          a renewal — are refunded <strong>in full</strong>. This applies to every paid plan,
          monthly and annual, including the Founding Pro annual offer. Refunds are processed through
          the payment provider you purchased from — Paddle outside India, Razorpay in India — back
          to your original payment method (Sections 4 and 5).
        </p>
        <p>
          One fair-use note, so the guarantee stays sustainable: the money-back guarantee can be
          used once per customer. We may also decline a refund where account activity shows the
          service was consumed in bulk and then refunded — for example, running a full cleanup of a
          mailbox and immediately requesting the money back. Statutory refund rights in your country
          (for example, EU consumer withdrawal rights) are not limited by this policy.
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
          <li>
            Charges older than the 30-day guarantee window in Section 3, except where law requires.
          </li>
          <li>
            A second use of the money-back guarantee — it can be used once per customer (Section
            3&rsquo;s fair-use terms).
          </li>
          <li>
            Accounts terminated for violating our <a href="/terms">Terms of Service</a> (abuse,
            unlawful use).
          </li>
        </ul>
        <p>
          One thing a refund does not do is reverse mailbox changes. Any Activity Undo already
          granted for Archive, Later, or Delete stays available until its recorded deadline
          regardless of billing state. Delete also has a separate Gmail Trash recovery path, and a
          delivered unsubscribe request cannot be recalled. Your current export and deletion options
          are described in the <a href="/privacy">Privacy Policy</a>.
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
