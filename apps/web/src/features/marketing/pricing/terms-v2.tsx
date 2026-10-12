import {
  hasLegalEntity,
  LEGAL_ENTITY_ADDRESS,
  LEGAL_ENTITY_NAME,
} from '@declutrmail/shared/copy/legal-entity';
import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory, termsPastDue } from '@declutrmail/shared/entitlements';

import { LegalSection } from '@/features/marketing/legal-layout';

/** Plans, the Pass, India, and the past-due window. The rest of Terms stays. */
export function TermsPlansV2() {
  return (
    <LegalSection id="plans-billing" title="4. Plans and billing">
      <p>{fillStory(WS1_COPY['terms.plans'])}</p>
      <p>{fillStory(WS1_COPY['terms.pass'])}</p>
      <ul>
        <li>
          <strong>Outside India:</strong> purchases are processed by Paddle, our merchant of record.
          Paddle handles payment, applicable taxes, and invoicing, and Paddle&rsquo;s buyer terms
          apply to the transaction.
        </li>
        <li>
          <strong>In India:</strong> {fillStory(WS1_COPY['terms.india'])}
        </li>
      </ul>
      <p>
        Refunds are described in our <a href="/refunds">Refund Policy</a>. {termsPastDue()} If the
        provider supplies no period end, the window starts when the past-due event is processed.
        Access can end sooner if the provider cancels or halts the subscription. When subscription
        access ends, your plan is Free unless a separate complimentary grant still applies; your
        data is not deleted.
      </p>
      <p>
        Paddle offers a 30-day pause: subscription access ends immediately and billing resumes
        automatically after 30 days. Razorpay plan changes, payment-method updates, pausing and
        undoing cancellation require support. Existing connected inboxes keep working after a
        downgrade; new connections are blocked while above your plan’s inbox limit.
      </p>
      {hasLegalEntity() ? (
        <p>
          {LEGAL_ENTITY_NAME}. {LEGAL_ENTITY_ADDRESS}.
        </p>
      ) : null}
    </LegalSection>
  );
}
