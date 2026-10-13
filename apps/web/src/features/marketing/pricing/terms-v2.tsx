import {
  hasLegalEntity,
  LEGAL_ENTITY_ADDRESS,
  LEGAL_ENTITY_NAME,
} from '@declutrmail/shared/copy/legal-entity';
import { BILLING_NAME } from '@declutrmail/shared/copy/screen-decisions';
import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory, termsPastDue } from '@declutrmail/shared/entitlements';

import { LegalSection } from '@/features/marketing/legal-layout';

/** Plans, the Pass, India, and the past-due window. The rest of Terms stays. */
export function TermsPlansV2() {
  return (
    <LegalSection id="plans-billing" title="4. Plans and billing">
      <p>{fillStory(WS1_COPY['terms.plans'])}</p>
      <p>{fillStory(WS1_COPY['terms.pass'])}</p>
      <p>
        Paddle is our merchant of record and reseller, so you buy your plan from Paddle. Paddle
        handles payment, tax and invoices, and Paddle&rsquo;s buyer terms apply to the purchase.
        This is the same everywhere, including India.
      </p>
      <p>
        If you already pay in rupees through Razorpay, your plan carries on and you can still manage
        it in {BILLING_NAME}. You can cancel there; to change, pause or restart it, email
        support@declutrmail.com. For these plans, DeclutrMail is the seller.
      </p>
      <p>
        Refunds are described in our <a href="/refunds">Refund Policy</a>. To ask for a refund,
        contact Paddle or email support@declutrmail.com. {termsPastDue()} If the provider supplies
        no period end, the window starts when the past-due event is processed. Access can end sooner
        if the provider cancels or halts the subscription. When subscription access ends, your plan
        is Free unless a separate complimentary grant still applies; your data is not deleted.
      </p>
      <p>
        Paddle offers a 30-day pause: your paid access ends right away and billing restarts
        automatically after 30 days. Gmail accounts you already connected keep working after a
        downgrade. You can&rsquo;t connect more while you&rsquo;re over your plan&rsquo;s limit.
      </p>
      {hasLegalEntity() ? (
        <p>
          {LEGAL_ENTITY_NAME}. {LEGAL_ENTITY_ADDRESS}.
        </p>
      ) : null}
    </LegalSection>
  );
}
