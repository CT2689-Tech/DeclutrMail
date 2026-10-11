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
import Link from 'next/link';
import {
  CASA_VERIFICATION_APPROVED_MONTH,
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_STORAGE_LABEL,
  PRIVACY_NEVER_LABEL,
} from '@declutrmail/shared';
import { MAX_UNDO_WINDOW_DAYS, MIN_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';
import {
  fillWs3,
  gatedText,
  glanceLines,
  securityContactEmail,
  SHOW_INJECTION_LINE,
  WS3_COPY,
} from '@declutrmail/shared/copy/launch';

import '@/features/marketing/product-story/product-story.css';
import { DocPage, DocSection } from '@/features/marketing/product-story';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { PAGE_LAST_UPDATED } from '@/features/marketing/page-dates';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Security — DeclutrMail',
  description: `DeclutrMail never fetches or stores full email contents, encrypts Google access tokens, and received Google OAuth verification approval in ${CASA_VERIFICATION_APPROVED_MONTH}.`,
  path: '/security',
});

const LAST_UPDATED = PAGE_LAST_UPDATED['/security'];

const TOC = [
  { id: 'at-a-glance', label: 'At a glance' },
  { id: 'the-boundary', label: 'What we store' },
  { id: 'oauth-scopes', label: 'OAuth scopes, and why' },
  { id: 'encryption', label: 'Encryption' },
  { id: 'verification', label: 'Verification' },
  { id: 'ai-processing', label: 'AI processing' },
  { id: 'no-prediction', label: 'No ML category prediction' },
  { id: 'deletion', label: 'Leaving cleanly' },
  { id: 'report', label: 'Report a vulnerability' },
] as const;

const AI_MORE = WS3_COPY['ws3.security.ai.more'];
const AI_MORE_LABEL = 'Privacy Policy, AI processing';

export default function SecurityPage() {
  return (
    <DocPage
      title="Security"
      lede="The strongest security control is not holding the data at all."
      lastUpdated={LAST_UPDATED}
      toc={TOC}
      highlights={[
        {
          id: 'the-boundary',
          label: 'Data boundary',
          detail: 'What is stored and what stays in Gmail',
        },
        {
          id: 'encryption',
          label: 'Token protection',
          detail: 'How Gmail access tokens are encrypted',
        },
        { id: 'deletion', label: 'Your exit', detail: 'Revoke, disconnect or delete' },
      ]}
    >
      <PageViewTracker page="security" />
      <section className="dm-doc-glance" id="at-a-glance" aria-labelledby="security-glance-title">
        <h2 id="security-glance-title">{WS3_COPY['ws3.security.glance.title']}</h2>
        <ul>
          {glanceLines().map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <DocSection id="the-boundary" title="What we store, and what we never store">
        <p>
          DeclutrMail&rsquo;s promise is literal: <strong>{PRIVACY_BADGE_HEADLINE}</strong>{' '}
          DeclutrMail requests only the Gmail details listed below.
        </p>
        <h3>{PRIVACY_STORAGE_LABEL}</h3>
        <ul>
          {PRIVACY_STORAGE_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h3>{PRIVACY_NEVER_LABEL}</h3>
        <ul>
          {PRIVACY_NEVER_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="dm-story-callout">{WS3_COPY['ws3.security.boundary.callout']}</p>
      </DocSection>

      <DocSection id="oauth-scopes" title="OAuth scopes, and why">
        <p>
          DeclutrMail requests one Gmail scope, <code>gmail.modify</code>, plus <code>openid</code>{' '}
          and your email address to identify the connected account. The product&rsquo;s job is to
          act on your email at your instruction — archive, label, delete, unsubscribe — and{' '}
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
      </DocSection>

      <DocSection id="encryption" title="Encryption">
        <p>
          All data is encrypted in transit (TLS) and at rest. Your Gmail OAuth tokens get an extra
          layer: each token is envelope-encrypted with its own fresh 256-bit data key (AES-256-GCM),
          and that key is in turn wrapped by a key-management-service key that never enters the
          application process. Tokens are never sent to your browser and never included in data
          exports.
        </p>
      </DocSection>

      <DocSection id="verification" title={WS3_COPY['ws3.security.verification.title']}>
        <p>{fillWs3(WS3_COPY['ws3.security.verification.oauth'])}</p>
        <p>{fillWs3(WS3_COPY['ws3.security.verification.casa'])}</p>
        <p>{fillWs3(WS3_COPY['ws3.security.verification.brand'])}</p>
        <p>{fillWs3(WS3_COPY['ws3.security.verification.closing'])}</p>
      </DocSection>

      <DocSection id="ai-processing" title={WS3_COPY['ws3.security.ai.title']}>
        <p>{fillWs3(WS3_COPY['ws3.security.ai.intro'])}</p>
        {gatedText('ws3.security.ai.explanations') ? (
          <p>{gatedText('ws3.security.ai.explanations')}</p>
        ) : null}
        {gatedText('ws3.security.ai.brief') ? <p>{gatedText('ws3.security.ai.brief')}</p> : null}
        {gatedText('ws3.security.ai.control') ? (
          <p>{gatedText('ws3.security.ai.control')}</p>
        ) : null}
        <p>{fillWs3(WS3_COPY['ws3.security.ai.training'])}</p>
        <p>{fillWs3(WS3_COPY['ws3.security.ai.limitedUse'])}</p>
        {SHOW_INJECTION_LINE ? <p>{fillWs3(WS3_COPY['ws3.security.ai.injection'])}</p> : null}
        <p>
          {AI_MORE.split(AI_MORE_LABEL)[0]}
          <Link href="/privacy#ai-processing">{AI_MORE_LABEL}</Link>
          {AI_MORE.split(AI_MORE_LABEL)[1]}
        </p>
      </DocSection>

      <DocSection id="no-prediction" title="No ML category prediction">
        <p>
          DeclutrMail does not use machine learning to predict email categories or route senders. It
          can automatically protect a sender using fixed product rules when strong engagement
          signals, such as your reply history, cross the documented threshold; you can review and
          change that protection. Mail-changing automation follows preset rules you explicitly
          enable — never a model&rsquo;s guess. We also do not use Gmail data to train generalized
          AI or machine-learning models.
        </p>
      </DocSection>

      <DocSection id="deletion" title="Leaving cleanly">
        <p>
          You can disconnect an inbox (which revokes our Google access, stops syncing, and preserves
          its historical DeclutrMail record for reconnection), delete one inbox&rsquo;s saved data,
          or schedule deletion of your whole account from Settings. Account deletion waits at least
          7 days, and also waits for any open undo window, so undo keeps working for its full
          window. Undo windows run {MIN_UNDO_WINDOW_DAYS} days on every plan, so a recent action
          commonly puts deletion up to {MAX_UNDO_WINDOW_DAYS} days out; you can waive both with a
          typed confirmation to delete immediately. Details are in the{' '}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </DocSection>

      <DocSection id="report" title="Report a vulnerability">
        <p>
          {fillWs3(WS3_COPY['ws3.security.report']).split(securityContactEmail())[0]}
          <a href={`mailto:${securityContactEmail()}`}>{securityContactEmail()}</a>
          {fillWs3(WS3_COPY['ws3.security.report']).split(securityContactEmail())[1]}
        </p>
      </DocSection>
      <nav className="dm-doc-section" aria-label="Related">
        <p>
          <Link href="/methodology">{WS3_COPY['ws3.security.crossLinks'][0]}</Link>
          {' · '}
          <Link href="/security">{WS3_COPY['ws3.security.crossLinks'][1]}</Link>
          {' · '}
          <Link href="/privacy">{WS3_COPY['ws3.security.crossLinks'][2]}</Link>
        </p>
      </nav>
    </DocPage>
  );
}
