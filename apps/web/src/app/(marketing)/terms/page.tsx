// Terms of Service (D146) — public, static prose; the only client JS
// is the D159 page-view tracker island.
//
// FOUNDER-CONFIRMED 2026-07-08 (D121 batch): governing law = India,
// courts of Mumbai (Section 10). Lawyer review remains deferred until
// the D146 validation threshold.

import type { Metadata } from 'next';
import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Terms of Service — DeclutrMail',
  description:
    'The terms that govern your use of DeclutrMail: service description, Gmail account requirement, plans and billing, acceptable use, and liability.',
  path: '/terms',
});

const LAST_UPDATED = '2026-07-08';

const TOC = [
  { id: 'service', label: 'The service' },
  { id: 'eligibility', label: 'Eligibility and your Google account' },
  { id: 'your-instructions', label: 'Actions run on your instructions' },
  { id: 'plans-billing', label: 'Plans and billing' },
  { id: 'acceptable-use', label: 'Acceptable use' },
  { id: 'beta', label: 'Early-stage service' },
  { id: 'your-data', label: 'Your data' },
  { id: 'disclaimers', label: 'Disclaimers and limitation of liability' },
  { id: 'termination', label: 'Termination' },
  { id: 'governing-law', label: 'Governing law' },
  { id: 'changes', label: 'Changes to these terms' },
  { id: 'contact', label: 'Contact' },
] as const;

export default function TermsOfServicePage() {
  return (
    <LegalPageLayout title="Terms of Service" lastUpdated={LAST_UPDATED} toc={TOC}>
      <PageViewTracker page="terms" />
      <LegalSection id="service" title="1. The service">
        <p>
          DeclutrMail (&ldquo;DeclutrMail&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is a Gmail
          cleanup service. It shows you your inbox organized by sender, recommends cleanup
          decisions, and — when you approve them — performs actions on your Gmail on your behalf:
          keep, archive, unsubscribe, later, or delete. Mail-changing actions are previewed before
          they run and recorded in an activity log. Available undo and recovery options depend on
          the action. By creating an account or using DeclutrMail you agree to these terms and to
          our <a href="/privacy">Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection id="eligibility" title="2. Eligibility and your Google account">
        <p>
          DeclutrMail works with Gmail. To use it you need a Google account and you must grant
          DeclutrMail OAuth access to that account. Your use of Gmail itself remains governed by
          Google&rsquo;s own terms, and Google may revoke or limit API access in ways outside our
          control. You must be at least 18 years old (or the age of majority where you live) and
          legally able to enter into these terms.
        </p>
        <p>
          You are responsible for the accuracy of the account you connect and for keeping your
          sign-in method secure. Connect only mailboxes you own or are authorized to manage.
        </p>
      </LegalSection>

      <LegalSection id="your-instructions" title="3. Actions run on your instructions">
        <p>
          DeclutrMail modifies your mailbox only at your instruction — either an action you approve
          directly, or a rule you explicitly enabled. Before any destructive action runs,
          DeclutrMail shows you a preview of exactly what will change. You are responsible for
          reviewing previews before approving actions. Archive and Later can be undone from Activity
          for 7 days. Delete moves mail to Gmail Trash, where Gmail may retain it for up to 30 days.
          A completed unsubscribe request cannot be recalled.
        </p>
        <p>
          Unsubscribe actions use the unsubscribe mechanisms senders publish. We cannot guarantee a
          sender honors its own unsubscribe process.
        </p>
      </LegalSection>

      <LegalSection id="plans-billing" title="4. Plans and billing">
        <p>
          DeclutrMail offers a Free plan and paid subscriptions (Plus and Pro), billed monthly or
          annually. Current pricing and what each plan includes are shown at purchase time.
          Subscriptions renew automatically until canceled; you can cancel at any time and keep
          access until the end of the period you paid for.
        </p>
        <ul>
          <li>
            <strong>Outside India:</strong> purchases are processed by Paddle, our merchant of
            record. Paddle handles payment, applicable taxes, and invoicing, and Paddle&rsquo;s
            buyer terms apply to the transaction.
          </li>
          <li>
            <strong>In India:</strong> payments are processed by Razorpay, and DeclutrMail is your
            seller.
          </li>
        </ul>
        <p>
          Refunds are described in our <a href="/refunds">Refund Policy</a>. If a payment fails or a
          subscription lapses, paid features stop and your account returns to the Free plan — your
          data is not deleted by a lapse.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" title="5. Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>use DeclutrMail on a mailbox you do not own or lack authorization to manage;</li>
          <li>use the service for anything unlawful, or to violate Google&rsquo;s terms;</li>
          <li>
            probe, overload, or disrupt the service, circumvent rate limits or plan limits, or
            access it by any means other than the product and interfaces we provide;
          </li>
          <li>reverse engineer the service except where law grants that right;</li>
          <li>resell, sublicense, or white-label the service without our written agreement.</li>
        </ul>
      </LegalSection>

      <LegalSection id="beta" title="6. Early-stage service">
        <p>
          DeclutrMail is a young product under active development. Features may change, be added, or
          be removed; sync may occasionally lag behind your mailbox; and we may impose reasonable
          usage limits to keep the service healthy for everyone. We will not remove a capability you
          paid for mid-cycle without a remedy (such as a pro-rata refund).
        </p>
      </LegalSection>

      <LegalSection id="your-data" title="7. Your data">
        <p>
          Your mailbox is yours. What we store, what we never store, and how to export or delete
          your data are described in the <a href="/privacy">Privacy Policy</a> — in short: we store
          sender, subject, Gmail&rsquo;s short preview, dates, labels and read/unread state, and we
          never fetch or store message bodies or attachments. You grant us only the limited license
          needed to operate the service on that data for you.
        </p>
      </LegalSection>

      <LegalSection id="disclaimers" title="8. Disclaimers and limitation of liability">
        <p>
          To the maximum extent permitted by law, DeclutrMail is provided &ldquo;as is&rdquo; and
          &ldquo;as available&rdquo;, without warranties of any kind, express or implied. We do not
          warrant that the service will be uninterrupted, error-free, or recoverable after an
          action&rsquo;s stated undo or recovery window.
        </p>
        <p>
          To the maximum extent permitted by law: (a) neither party is liable for indirect,
          incidental, special, or consequential damages, or for loss of profits, revenue, or data;
          and (b) our total aggregate liability arising out of or relating to the service is limited
          to the amount you paid us in the 12 months before the event giving rise to the claim (or
          USD 50 if you have paid us nothing). Nothing in these terms excludes liability that cannot
          be excluded under applicable law.
        </p>
      </LegalSection>

      <LegalSection id="termination" title="9. Termination">
        <p>
          You can stop using DeclutrMail at any time: disconnect your inbox, or delete your account
          from Settings (deletion mechanics, including the grace period and undo windows, are
          described in the <a href="/privacy">Privacy Policy</a>). We may suspend or terminate
          accounts that violate these terms, abuse the service, or create security risk — with
          notice where practicable. Sections 7–10 survive termination.
        </p>
      </LegalSection>

      <LegalSection id="governing-law" title="10. Governing law">
        <p>
          These terms are governed by the laws of India, and the courts at Mumbai, Maharashtra have
          exclusive jurisdiction over disputes arising from them — except that if you purchased
          through Paddle as merchant of record, the transaction itself is governed by Paddle&rsquo;s
          buyer terms. If you are a consumer, you keep any mandatory protections of the law of the
          country where you live.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="11. Changes to these terms">
        <p>
          We may update these terms as the product and the law evolve. For material changes we will
          notify you by email or in the product before they take effect; continuing to use
          DeclutrMail after that date means you accept the updated terms. The date at the top of
          this page always reflects the latest revision.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="12. Contact">
        <p>
          Questions about these terms:{' '}
          <a href="mailto:support@declutrmail.com">support@declutrmail.com</a>
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
