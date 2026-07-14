// Privacy Policy (D146) — public, static prose; the only client JS is
// the D159 page-view tracker island.
//
// CONTENT CONTRACT (CLAUDE.md §2.1, D7, D228): the "what we store /
// what we never store" lists are imported from
// `@declutrmail/shared`'s locked privacy copy module — the single
// source of truth the `check-microcopy.sh --rule=privacy-badge` audit
// guards. Do not paraphrase those lists here.
//
// FOUNDER-REVIEW-GATED: legal copy ships only after founder sign-off
// (D146 — lawyer review deferred until validation threshold).

import type { Metadata } from 'next';
import {
  DATA_EXPORT_FORMAT_MANIFEST,
  DATA_EXPORT_LIMITATION,
  GMAIL_CONNECTION_DATA_INVENTORY,
  GMAIL_DATA_PROCESSORS,
  GMAIL_DERIVED_DATA_INVENTORY,
  GMAIL_OAUTH_ACCESS,
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_STORAGE_LABEL,
  PRIVACY_NEVER_LABEL,
} from '@declutrmail/shared';
import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Privacy Policy — DeclutrMail',
  description:
    'What DeclutrMail can access, fetches, stores, derives, exports, and retains — and what it never fetches.',
  path: '/privacy',
});

const LAST_UPDATED = '2026-07-14';

const TOC = [
  { id: 'who-we-are', label: 'Who we are' },
  { id: 'what-we-store', label: 'What we store — and what we never store' },
  { id: 'how-we-access-gmail', label: 'How we access your Gmail' },
  { id: 'google-limited-use', label: 'Google API Services — Limited Use disclosure' },
  { id: 'how-we-use-data', label: 'How we use your data' },
  { id: 'cookies', label: 'Cookies and analytics' },
  { id: 'retention-deletion', label: 'Data retention and deletion' },
  { id: 'subprocessors', label: 'Subprocessors' },
  { id: 'your-rights', label: 'Your rights (GDPR and DPDP)' },
  { id: 'security', label: 'Security' },
  { id: 'changes', label: 'Changes to this policy' },
  { id: 'contact', label: 'Contact' },
] as const;

export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated={LAST_UPDATED} toc={TOC}>
      <PageViewTracker page="privacy" />
      <LegalSection id="who-we-are" title="1. Who we are">
        <p>
          DeclutrMail (&ldquo;DeclutrMail&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is a Gmail
          cleanup service: it helps you decide, once per sender, what should happen to the email you
          no longer want — keep it, archive it, unsubscribe from it, deal with it later, or delete
          it — with a preview before mail changes and action-specific recovery options.
        </p>
        <p>
          For the purposes of the EU General Data Protection Regulation (GDPR), DeclutrMail is the
          data controller for the data described in this policy. For the purposes of India&rsquo;s
          Digital Personal Data Protection Act, 2023 (DPDP Act), DeclutrMail is the Data Fiduciary.
          Contact details are in <a href="#contact">Section 12</a>.
        </p>
      </LegalSection>

      <LegalSection id="what-we-store" title="2. What we store — and what we never store">
        <p>
          Our entire product is built around one boundary: <strong>{PRIVACY_BADGE_HEADLINE}</strong>
          . We never fetch or store the body of your messages. Here is the exact list of what we do
          store, and what we do not.
        </p>
        <p>
          <strong>{PRIVACY_STORAGE_LABEL}</strong>
        </p>
        <ul>
          {PRIVACY_STORAGE_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          <strong>{PRIVACY_NEVER_LABEL}</strong>
        </p>
        <ul>
          {PRIVACY_NEVER_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          The &ldquo;Gmail Preview&rdquo; above is the short snippet Gmail itself computes and shows
          in your inbox list (roughly 160 characters). We receive it from Gmail&rsquo;s API in
          metadata form — we never download or parse the message body to produce it.
        </p>
        <p>The complete inventory also includes connection and product-derived data:</p>
        <ul>
          {[...GMAIL_CONNECTION_DATA_INVENTORY, ...GMAIL_DERIVED_DATA_INVENTORY].map((item) => (
            <li key={item.id}>
              <strong>{item.label}</strong> — {item.purpose} {item.retention}
            </li>
          ))}
        </ul>
        <p>
          We also store your DeclutrMail preferences and billing records. Payment providers handle
          card details; DeclutrMail never sees or stores full card numbers.
        </p>
      </LegalSection>

      <LegalSection id="how-we-access-gmail" title="3. How we access your Gmail">
        <p>
          DeclutrMail connects to your Gmail account through Google&rsquo;s official API, using
          OAuth consent you grant explicitly. We request the <code>gmail.modify</code> scope — a
          restricted scope — because the product&rsquo;s job is to act on your mail at your
          instruction: archive, label, delete, and unsubscribe.
        </p>
        <ul>
          {GMAIL_OAUTH_ACCESS.map((access) => (
            <li key={access.scope}>
              <code>{access.scope}</code> — {access.label}. {access.usedFor}
            </li>
          ))}
        </ul>
        <ul>
          <li>
            Message data is fetched in <strong>metadata format only</strong>, using the complete
            generated field list in Section 2. We do not request message bodies or attachments from
            the API.
          </li>
          <li>
            Every destructive action shows you a preview of exactly what will change before it runs,
            and every result is recorded in your Activity log. Available undo and recovery options
            depend on the action.
          </li>
          <li>
            OAuth tokens are encrypted at rest and are never included in data exports or sent to
            your browser.
          </li>
          <li>
            As an app using a restricted Gmail scope, DeclutrMail undergoes Google&rsquo;s
            independent CASA (Cloud Application Security Assessment) Tier 2 security verification,
            renewed annually.
          </li>
        </ul>
        <p>
          You can revoke DeclutrMail&rsquo;s access at any time from DeclutrMail&rsquo;s settings or
          directly from your{' '}
          <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">
            Google account permissions page
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="google-limited-use" title="4. Google API Services — Limited Use disclosure">
        <p>
          DeclutrMail&rsquo;s use and transfer to any other app of information received from Google
          APIs will adhere to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. In plain terms:
        </p>
        <ul>
          <li>We only use Gmail data to provide and improve user-facing DeclutrMail features.</li>
          <li>We do not sell Gmail data, and we do not use it for advertising of any kind.</li>
          <li>
            We transfer selected Gmail data only to the subprocessors needed to run the service (
            <a href="#subprocessors">Section 8</a>), as required by law, or as part of a merger or
            acquisition with notice to you.
          </li>
          <li>
            Humans at DeclutrMail do not read your Gmail data, except with your explicit permission
            (for example, a support request you initiate), where required for security or abuse
            investigation, or where required by law.
          </li>
          <li>
            We do not use Gmail data to train generalized artificial-intelligence or
            machine-learning models.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="how-we-use-data" title="5. How we use your data">
        <p>We use the data described above to:</p>
        <ul>
          <li>
            Show a per-sender view of your inbox, observed activity facts, and optional suggestions.
            DeclutrMail does not use machine learning to predict email categories or auto-protect
            senders; decisions are yours or follow rules you explicitly enabled.
          </li>
          <li>
            Execute the actions you approve (archive, unsubscribe, delete, label) on your Gmail.
          </li>
          <li>
            Keep an activity log so results are auditable and any available undo can be used during
            its window.
          </li>
          <li>Operate your subscription and billing.</li>
          <li>
            Send you transactional email about your account (sync status, receipts, security
            notices). Product-update email is optional and opt-out.
          </li>
          <li>
            Monitor errors and service health, and — with your consent — understand which features
            matter.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="cookies" title="6. Cookies and analytics">
        <p>
          We use essential cookies for sign-in and billing — these are required for the service to
          function and do not need consent. Optional analytics (PostHog) is initialized only after
          you accept it in the cookie banner; it is off by default. We never use advertising cookies
          or cross-site trackers, and our analytics never sees your inbox content. You can change or
          withdraw your choice at any time on the <a href="/cookies">Cookie preferences</a> page
          (also in the app under Settings); withdrawal takes effect immediately.
        </p>
      </LegalSection>

      <LegalSection id="retention-deletion" title="7. Data retention and deletion">
        <p>You can leave cleanly, in three tiers, all from Settings:</p>
        <ul>
          <li>
            <strong>Disconnect an inbox</strong> — revokes our Google access and stops all syncing
            for that inbox. Your historical activity log is kept so you can reconnect later.
          </li>
          <li>
            <strong>Delete an inbox&rsquo;s data</strong> — wipes everything DeclutrMail stored
            about that inbox (messages metadata, sender profiles, decisions, activity).
          </li>
          <li>
            <strong>Delete your DeclutrMail account</strong> — removes all inboxes, all activity,
            all preferences, and your account itself, with no recovery.
          </li>
        </ul>
        <p>
          Account deletion has a <strong>7-day grace period</strong> during which you can change
          your mind. If you have recent actions still inside an undo window longer than 7 days
          (Pro&rsquo;s 30-day undo), deletion is scheduled after the latest undo window expires — so
          &ldquo;undo always works for its full window&rdquo; stays true. If you want deletion
          sooner, you can explicitly waive the grace period and any remaining undo windows with a
          typed confirmation during the deletion flow — deletion then takes effect immediately. Once
          deletion is scheduled, syncing stops immediately.
        </p>
        <p>
          You can export the current JSON and CSV datasets at any time from Settings → Privacy &amp;
          Data. {DATA_EXPORT_FORMAT_MANIFEST.json.description} {DATA_EXPORT_LIMITATION}
        </p>
      </LegalSection>

      <LegalSection id="subprocessors" title="8. Subprocessors">
        <p>
          We use a small set of infrastructure providers to run DeclutrMail. Each processes data
          only on our instructions:
        </p>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Google Cloud</td>
              <td>API and worker hosting; Gmail API access; push notifications</td>
            </tr>
            <tr>
              <td>Supabase</td>
              <td>Postgres database (the metadata listed in Section 2)</td>
            </tr>
            <tr>
              <td>Anthropic</td>
              <td>
                {GMAIL_DATA_PROCESSORS.Anthropic.purpose} Selected inputs and generated output are
                retained under{' '}
                <a href={GMAIL_DATA_PROCESSORS.Anthropic.privacyUrl} rel="noopener noreferrer">
                  Anthropic&rsquo;s API retention terms
                </a>
                : {GMAIL_DATA_PROCESSORS.Anthropic.retention}
              </td>
            </tr>
            <tr>
              <td>Vercel</td>
              <td>Web application hosting</td>
            </tr>
            <tr>
              <td>Upstash</td>
              <td>Redis — job queues and rate limiting</td>
            </tr>
            <tr>
              <td>Sentry</td>
              <td>Error monitoring (no message content in events)</td>
            </tr>
            <tr>
              <td>PostHog</td>
              <td>Product analytics — only with your cookie consent</td>
            </tr>
            <tr>
              <td>Resend</td>
              <td>Transactional email delivery</td>
            </tr>
            <tr>
              <td>Paddle</td>
              <td>Merchant of record and payment processing (outside India)</td>
            </tr>
            <tr>
              <td>Razorpay</td>
              <td>Payment processing (India)</td>
            </tr>
          </tbody>
        </table>
        <p>We will update this list before adding a new subprocessor that handles personal data.</p>
      </LegalSection>

      <LegalSection id="your-rights" title="9. Your rights (GDPR and DPDP)">
        <p>
          If you are in the European Economic Area or the United Kingdom, you have the rights the
          GDPR gives you: access, rectification, erasure, restriction, portability, and objection.
          Most of these are self-serve in the product (export and deletion in Settings → Privacy
          &amp; Data); for anything else, email us. You also have the right to lodge a complaint
          with your local supervisory authority.
        </p>
        <p>
          If you are in India, the DPDP Act, 2023 applies: DeclutrMail is the Data Fiduciary, and
          processing is based on your explicit consent given when you connect your Gmail account,
          for the lawful purpose of providing the email cleanup service described here. As a Data
          Principal you have the right to access, correct, and erase your personal data, and the
          right to grievance redressal. You may withdraw consent at any time by disconnecting your
          inbox or deleting your account. In the event of a personal data breach affecting you, we
          will notify you and the Data Protection Board of India as the Act requires.
        </p>
        <p>
          Grievance officer and privacy contact:{' '}
          <a href="mailto:privacy@declutrmail.com">privacy@declutrmail.com</a>. We respond within 30
          days.
        </p>
      </LegalSection>

      <LegalSection id="security" title="10. Security">
        <p>
          All data is encrypted in transit (TLS) and at rest. OAuth tokens are additionally
          envelope-encrypted with a managed key service. Access to production systems is limited and
          logged. And because we never store message bodies or attachments, the most sensitive
          content in your mailbox is simply not in our systems to begin with — that is the point of
          the design.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="11. Changes to this policy">
        <p>
          When we make a material change — a new data type, a new subprocessor, a change in how we
          access Gmail — we will update this page, change the date at the top, and notify you by
          email before the change takes effect. We will never silently expand what we store.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="12. Contact">
        <p>
          Privacy questions and data requests:{' '}
          <a href="mailto:privacy@declutrmail.com">privacy@declutrmail.com</a>
          <br />
          General support: <a href="mailto:support@declutrmail.com">support@declutrmail.com</a>
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
