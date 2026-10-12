import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory } from '@declutrmail/shared/entitlements';

import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { PAGE_LAST_UPDATED } from '@/features/marketing/page-dates';

const LAST_UPDATED = PAGE_LAST_UPDATED['/refunds'];

export function RefundsV2() {
  const toc = [
    { id: 'summary', label: 'The short version' },
    { id: 'cancellation', label: 'Cancellation' },
    { id: 'refund-window', label: fillStory(WS1_COPY['refunds.toc.window']) },
    { id: 'paddle', label: 'Purchases outside India (Paddle)' },
    { id: 'razorpay', label: 'Purchases in India' },
    { id: 'exclusions', label: 'What is not refundable' },
    { id: 'how-to-request', label: 'How to request a refund' },
  ] as const;
  return (
    <LegalPageLayout title="Refund Policy" lastUpdated={LAST_UPDATED} toc={toc}>
      <PageViewTracker page="refunds" />
      <LegalSection id="summary" title="1. The short version">
        <p>{fillStory(WS1_COPY['refunds.summary'])}</p>
      </LegalSection>
      <LegalSection id="cancellation" title="2. Cancellation">
        <p>{fillStory(WS1_COPY['refunds.cancelNoRefund'])}</p>
      </LegalSection>
      <LegalSection id="refund-window" title={`3. ${fillStory(WS1_COPY['refunds.toc.window'])}`}>
        <p>{fillStory(WS1_COPY['refunds.window'])}</p>
        <p>{fillStory(WS1_COPY['refunds.pass'])}</p>
        <p>
          For a full refund of your purchase or renewal charge, subscription access ends when the
          payment provider confirms the refund or the refund-review access deadline is reached,
          whichever comes first, and your account moves to the Free plan unless a separate
          complimentary grant applies — this is the one way it differs from canceling, which keeps
          your features until the end of the period you paid for (Section 2). Your data is untouched
          either way, and nothing stops you subscribing again later.
        </p>
        <p>
          A full refund of only a Paddle upgrade charge reverses that upgrade instead of ending the
          whole subscription. The reversal preserves the remaining access and original renewal terms
          of your previously paid plan; it does not refund that plan&rsquo;s charge. If we cannot
          confirm the reversal, Billing asks you to contact support and shows your currently
          verified access while we review it.
        </p>
        <p>{fillStory(WS1_COPY['refunds.oncePerCustomer'])}</p>
      </LegalSection>
      <LegalSection id="paddle" title="4. Purchases outside India (Paddle)">
        <p>
          If you purchased outside India, your payment was processed by Paddle, our merchant of
          record. Paddle is the seller of record for the transaction, and{' '}
          <a href="https://www.paddle.com/legal/checkout-buyer-terms" rel="noopener noreferrer">
            Paddle&rsquo;s buyer terms
          </a>{' '}
          apply to it. You can request a refund either from us directly (
          <a href="mailto:support@declutrmail.com">support@declutrmail.com</a>) or from Paddle via
          the receipt email they sent you.
        </p>
      </LegalSection>
      <LegalSection id="razorpay" title="5. Purchases in India">
        <p>{fillStory(WS1_COPY['refunds.india'])}</p>
      </LegalSection>
      <LegalSection id="exclusions" title="6. What is not refundable">
        <ul>
          <li>{fillStory(WS1_COPY['refunds.exclusions.window'])}</li>
          <li>{fillStory(WS1_COPY['refunds.exclusions.second'])}</li>
          <li>
            Accounts terminated for violating our <a href="/terms">Terms of Service</a> (abuse,
            unlawful use).
          </li>
        </ul>
      </LegalSection>
      <LegalSection id="how-to-request" title="7. How to request a refund">
        <p>{fillStory(WS1_COPY['pricing.faq.refunds.a'])}</p>
      </LegalSection>
    </LegalPageLayout>
  );
}
