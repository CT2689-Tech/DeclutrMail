// /security — privacy-first trust page (launch marketing bundle).
//
// Public marketing route: static prose, no auth round-trip; the only
// client JS is the D159 page-view tracker island.
//
// CONTENT CONTRACT: every claim on this page is verifiable in the
// repo. Storage lists come verbatim from `@declutrmail/shared`'s
// locked privacy copy (CLAUDE.md §2.1, D7, D228). Scope claims match
// apps/api/src/auth/google-oauth.service.ts (gmail.modify + openid +
// userinfo.email — the only scopes requested). Encryption claims match
// apps/api/src/auth/token-crypto.service.ts (D14 envelope encryption).
// Metadata-only fetching matches apps/api/src/gmail/gmail-client.service.ts
// (`format=metadata`, never `full`/`raw`). CASA Tier 2 is verified for
// the production OAuth client. Do not add a claim without checking it.

import type { Metadata } from 'next';
import {
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_STORAGE_LABEL,
  PRIVACY_NEVER_LABEL,
  GMAIL_METADATA_HEADERS,
  GMAIL_OAUTH_ACCESS,
  TechnicalDetails,
} from '@declutrmail/shared';
import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Security — DeclutrMail',
  description:
    'How DeclutrMail protects your Gmail: full bodies fetched: 0, narrowly used Google access, separately encrypted credentials, and independent CASA Tier 2 verification.',
  path: '/security',
});

const LAST_UPDATED = '2026-07-14';

const TOC = [
  { id: 'the-boundary', label: 'The boundary: what we store, what we never store' },
  { id: 'oauth-scopes', label: 'Google access, and why' },
  { id: 'encryption', label: 'Encryption' },
  { id: 'verification', label: 'Independent verification (CASA Tier 2)' },
  { id: 'no-prediction', label: 'No ML category prediction' },
  { id: 'deletion', label: 'Leaving cleanly' },
  { id: 'report', label: 'Report a vulnerability' },
] as const;

export default function SecurityPage() {
  return (
    <LegalPageLayout title="Security" label="Security" lastUpdated={LAST_UPDATED} toc={TOC}>
      <PageViewTracker page="security" />
      <LegalSection id="the-boundary" title="The boundary: what we store, what we never store">
        <p>
          The strongest security control is not holding the data at all. DeclutrMail&rsquo;s
          boundary is literal: <strong>{PRIVACY_BADGE_HEADLINE}</strong>. Message data is fetched
          from Gmail only as the listed sender and message fields — never as full messages.
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
          {PRIVACY_NEVER_ITEMS.slice(0, 4).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <TechnicalDetails summary="Show message-format and header exclusions">
          <ul>
            {PRIVACY_NEVER_ITEMS.slice(4).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </TechnicalDetails>
        <p>
          Not fetching bodies or attachments materially reduces the Gmail data DeclutrMail could
          expose. Stored fields such as subjects and Gmail Preview snippets can still contain
          sensitive information, so they receive the encryption and access controls described below.
        </p>
      </LegalSection>

      <LegalSection id="oauth-scopes" title="Google access, and why">
        <p>
          Google asks you to let DeclutrMail read Gmail data and change Gmail labels, and to
          identify the Google account you connect. We use that access to fetch only the fields
          listed above and to run mail changes you approve, such as Archive, Later, and Delete.
          Connecting by itself changes no mail.
        </p>
        <p>
          You can revoke access at any time from Settings or from your{' '}
          <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">
            Google account permissions page
          </a>
          .
        </p>
        <TechnicalDetails summary="Show Google permission and field details">
          <p>The exact permissions requested are:</p>
          <ul>
            {GMAIL_OAUTH_ACCESS.map((access) => (
              <li key={access.scope}>
                <code>{access.scope}</code> — {access.usedFor}
              </li>
            ))}
          </ul>
          <p>
            Gmail message requests use <code>format=metadata</code>, never <code>full</code> or{' '}
            <code>raw</code>. The generated header allowlist is{' '}
            <code>{GMAIL_METADATA_HEADERS.join(', ')}</code>; other Gmail headers are not requested
            by the message adapter.
          </p>
        </TechnicalDetails>
      </LegalSection>

      <LegalSection id="encryption" title="Encryption">
        <p>
          Data is encrypted while moving between systems and while stored. The saved Google
          credential gets a separate encryption key and is never sent to your browser or included in
          data exports.
        </p>
        <TechnicalDetails summary="Show encryption details">
          Data in transit uses TLS. Each Google OAuth token is envelope-encrypted with a fresh
          256-bit AES-256-GCM data key. A key-management-service key wraps that data key without
          entering the application process.
        </TechnicalDetails>
      </LegalSection>

      <LegalSection id="verification" title="Independent verification (CASA Tier 2)">
        <p>
          As an app using a restricted Gmail scope, DeclutrMail has passed Google&rsquo;s
          independent CASA (Cloud Application Security Assessment) <strong>Tier 2</strong> security
          verification, which is renewed annually.
        </p>
      </LegalSection>

      <LegalSection id="no-prediction" title="No ML category prediction">
        <p>
          DeclutrMail does not use machine learning to predict email categories or route senders. It
          can automatically protect a sender using deterministic product rules, such as when your
          reply history crosses the documented protection threshold; you can review and change that
          protection. Mail-changing automation follows rules you explicitly enable, not a
          model&rsquo;s guess. We also do not use Gmail data to train generalized AI or
          machine-learning models.
        </p>
      </LegalSection>

      <LegalSection id="deletion" title="Leaving cleanly">
        <p>
          You can disconnect an inbox (removes our saved Google credential and stops syncing),
          delete one inbox&rsquo;s indexed data, or delete your account and mailbox product data —
          all from Settings. Account deletion has a 7-day grace period, and a longer open undo
          window can extend the deletion date. Narrowly scoped pseudonymous security and deletion
          evidence remains under the operational retention policy. Details are in the{' '}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection id="report" title="Report a vulnerability">
        <p>
          If you believe you have found a security vulnerability in DeclutrMail, email{' '}
          <a href="mailto:privacy@declutrmail.com">privacy@declutrmail.com</a> with the details. We
          read every report and will respond, and we ask that you give us reasonable time to fix an
          issue before disclosing it publicly.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
