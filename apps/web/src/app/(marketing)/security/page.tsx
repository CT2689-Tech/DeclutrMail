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
// (`format=metadata`, never `full`/`raw`). CASA: Google approved the
// OAuth verification on 21 Apr 2026 (FOUNDER-FOLLOWUPS 2026-07-26), and
// the approval email is the only artifact — there is no issued letter or
// certificate, so do not imply one. Recertification is annual; treat
// 21 Apr 2027 as the operative deadline.

import type { Metadata } from 'next';
import {
  CASA_VERIFICATION_APPROVED_MONTH,
  CASA_VERIFICATION_APPROVED_ON,
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
  title: 'Security — DeclutrMail',
  description: `DeclutrMail never fetches or stores full email contents, encrypts Google access tokens, and received Google OAuth verification approval in ${CASA_VERIFICATION_APPROVED_MONTH}.`,
  path: '/security',
});

const LAST_UPDATED = '2026-08-07';

const TOC = [
  { id: 'the-boundary', label: 'The boundary: what we store, what we never store' },
  { id: 'oauth-scopes', label: 'OAuth scopes, and why' },
  { id: 'encryption', label: 'Encryption' },
  { id: 'verification', label: 'Independent assessment (CASA Tier 2)' },
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
          The strongest security control is not holding the data at all. DeclutrMail&rsquo;s promise
          is literal: <strong>{PRIVACY_BADGE_HEADLINE}</strong> DeclutrMail requests only the Gmail
          details listed below.
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
          Because full email contents and attachments are never in our systems, they cannot leak
          from DeclutrMail. Subject lines and Gmail preview snippets can still contain sensitive
          information, so we list and protect them explicitly.
        </p>
      </LegalSection>

      <LegalSection id="oauth-scopes" title="OAuth scopes, and why">
        <p>
          DeclutrMail requests one Gmail scope, <code>gmail.modify</code>, plus <code>openid</code>{' '}
          and your email address to identify the connected account. The product&rsquo;s job is to
          act on your mail at your instruction — archive, label, delete, unsubscribe — and{' '}
          <code>gmail.modify</code> is the scope that permits those label changes.
        </p>
        <p>
          This permission is broader than what DeclutrMail uses. The app requests only the listed
          fields and never asks Gmail for the full or raw email formats that include complete
          contents and attachments. You can revoke access at any time from Settings or from your{' '}
          <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">
            Google account permissions page
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="encryption" title="Encryption">
        <p>
          All data is encrypted in transit (TLS) and at rest. Your Gmail OAuth tokens get an extra
          layer: each token is envelope-encrypted with its own fresh 256-bit data key (AES-256-GCM),
          and that key is in turn wrapped by a key-management-service key that never enters the
          application process. Tokens are never sent to your browser and never included in data
          exports.
        </p>
      </LegalSection>

      <LegalSection id="verification" title="Independent assessment (CASA Tier 2)">
        <p>
          Apps using restricted Gmail scopes are subject to Google&rsquo;s independent CASA (Cloud
          Application Security Assessment) process. Google{' '}
          <strong>
            approved DeclutrMail&rsquo;s OAuth verification on {CASA_VERIFICATION_APPROVED_ON}
          </strong>{' '}
          for the single restricted scope we request, <code>gmail.modify</code>. Verification is
          recertified annually, and any new scope or change to our consent screen requires a fresh
          review.
        </p>
      </LegalSection>

      <LegalSection id="no-prediction" title="No ML category prediction">
        <p>
          DeclutrMail does not use machine learning to predict email categories or route senders. It
          can automatically protect a sender using fixed product rules when strong engagement
          signals, such as your reply history, cross the documented threshold; you can review and
          change that protection. Mail-changing automation follows preset rules you explicitly
          enable — never a model&rsquo;s guess. We also do not use Gmail data to train generalized
          AI or machine-learning models.
        </p>
      </LegalSection>

      <LegalSection id="deletion" title="Leaving cleanly">
        <p>
          You can disconnect an inbox (which revokes our Google access, stops syncing, and preserves
          its historical DeclutrMail record for reconnection), delete one inbox&rsquo;s saved data,
          or schedule deletion of your whole account from Settings. Account deletion has a 7-day
          grace period, and if you have actions still inside a longer undo window, deletion is
          scheduled after the latest window expires so undo keeps working for its full window.
          Details are in the <a href="/privacy">Privacy Policy</a>.
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
