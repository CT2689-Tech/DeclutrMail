// /contact — support contact page (launch marketing bundle, D219 kin).
//
// Public marketing route: static prose, no auth round-trip; the only
// client JS is the D159 page-view tracker island. Deliberately NO
// contact form — there is no backend for one; the two published
// mailboxes are the support surface. Response-time promise is kept
// modest ("within 2 business days") and matches /refunds §7.

import type { Metadata } from 'next';
import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Contact — DeclutrMail',
  description:
    'How to reach DeclutrMail: support@declutrmail.com for general questions and support, privacy@declutrmail.com for privacy and data requests.',
  path: '/contact',
});

const LAST_UPDATED = '2026-07-07';

const TOC = [
  { id: 'support', label: 'General questions and support' },
  { id: 'privacy-requests', label: 'Privacy and data requests' },
  { id: 'before-you-write', label: 'Before you write' },
] as const;

export default function ContactPage() {
  return (
    <LegalPageLayout title="Contact" label="Support" lastUpdated={LAST_UPDATED} toc={TOC}>
      <PageViewTracker page="contact" />
      <LegalSection id="support" title="General questions and support">
        <p>
          Email <a href="mailto:support@declutrmail.com">support@declutrmail.com</a> for anything —
          questions, bugs, billing, refunds, or feedback. We reply within{' '}
          <strong>2 business days</strong>.
        </p>
      </LegalSection>

      <LegalSection id="privacy-requests" title="Privacy and data requests">
        <p>
          Email <a href="mailto:privacy@declutrmail.com">privacy@declutrmail.com</a> for privacy
          questions, data access or deletion requests, and to report a security vulnerability. This
          is also the grievance contact named in the <a href="/privacy">Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection id="before-you-write" title="Before you write">
        <p>
          The <a href="/help">Help &amp; FAQ page</a> answers the most common questions — what
          DeclutrMail stores, how undo works, and how to disconnect a mailbox or delete your
          account.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
