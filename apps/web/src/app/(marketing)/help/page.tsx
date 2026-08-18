// /help — single-page FAQ (D219; content drawn from D137).
//
// Public marketing route: static prose, no auth round-trip; the only
// client JS is the D159 page-view tracker island. Each question is a
// LegalSection with a stable slug so answers deep-link (`/help#undo-windows`,
// D219). One content array feeds BOTH the rendered Q&A and the FAQPage
// JSON-LD (same single-source rule as the landing FAQ — parallel
// copies are how the two drift apart).
//
// CONTENT CONTRACT (CLAUDE.md §2.1, D7, D228): the storage answer
// quotes the locked privacy copy module from `@declutrmail/shared`
// verbatim — never paraphrased. Refund terms were founder-confirmed
// 2026-07-08 (D121): 30-day money-back guarantee on every paid plan;
// the answer states it and links /refunds for the full terms.

import type { Metadata } from 'next';
import {
  ACTION_SAFETY_SUMMARY,
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_STORAGE_ITEMS,
} from '@declutrmail/shared';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { JsonLd } from '@/features/marketing/json-ld';
import { siteUrl } from '@/features/marketing/landing/urls';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Help & FAQ — DeclutrMail',
  description:
    'What DeclutrMail stores, how Unsubscribe works, what Archive, Later, and Delete do in Gmail terms, undo windows, Autopilot modes, and how to reach support.',
  path: '/help',
});

const LAST_UPDATED = '2026-08-04';

/**
 * One source for the rendered Q&A and the FAQPage JSON-LD. Answers are
 * plain strings (plus an optional trailing link) — the landing FAQ
 * pattern (features/marketing/landing/faq.tsx).
 */
const FAQS: ReadonlyArray<{
  id: string;
  q: string;
  a: string;
  link?: { href: string; label: string };
}> = [
  {
    id: 'what-we-store',
    q: 'What does DeclutrMail store from my Gmail?',
    a: `${PRIVACY_BADGE_HEADLINE} DeclutrMail stores these Gmail details: ${PRIVACY_STORAGE_ITEMS.join('; ')}. The privacy policy separately explains the account, preference, action, service-provider, and billing records needed to run the service.`,
    link: { href: '/privacy', label: 'Privacy policy →' },
  },
  {
    id: 'unsubscribe-flow',
    q: 'How does Unsubscribe work?',
    a: 'Where a sender supports the one-click unsubscribe standard (Gmail’s list-unsubscribe), DeclutrMail sends the unsubscribe request for you and tracks the result. Where a sender only offers a mailto: unsubscribe address, we prepare the email and you send it yourself from Gmail — nothing is auto-sent on your behalf. The request asks the sender to stop future mail; the sender controls whether and when delivery stops. Nothing already in your inbox moves.',
  },
  {
    id: 'bulk-unsubscribe',
    q: 'Can I unsubscribe from all my newsletters at once?',
    a: 'There is no single “unsubscribe from everything” button. DeclutrMail ranks your senders by how much they email you so you can start with the busiest. Every plan lets you review and act on several senders at once; on Free, those actions count toward the monthly limit. One-click requests run separately. When a sender requires an unsubscribe email, DeclutrMail gives you a checklist of prefilled Gmail drafts to open and send. Senders without an unsubscribe option are skipped so you can choose Archive instead.',
    link: { href: '/pricing', label: 'Compare plans →' },
  },
  {
    id: 'actions-in-gmail-terms',
    q: 'What do Archive, Later, and Delete actually do in Gmail?',
    a: 'Archive removes the messages from your inbox — Gmail keeps them in All Mail, searchable as ever. Later moves them out of the inbox into a DeclutrMail/Later label so you can come back to them. Delete moves them to Gmail’s Trash, normally for up to 30 days; permanently deleting a message or emptying Trash can end recovery sooner. Keep leaves everything where it is.',
  },
  {
    id: 'undo-windows',
    q: 'What can I undo, and for how long?',
    a: `${ACTION_SAFETY_SUMMARY} The Archive, Later, and Delete Activity Undo window is 7 days on Free and Plus and 30 days on Pro.`,
  },
  {
    id: 'disconnect-mailbox',
    q: 'How do I disconnect a mailbox?',
    a: 'Open the Gmail account menu in the app’s top bar and choose Disconnect for that mailbox. That revokes DeclutrMail’s Google access and stops all syncing and actions for it immediately; your historical activity log is kept so you can reconnect later. You can also revoke access directly from your Google account permissions page.',
  },
  {
    id: 'delete-account',
    q: 'How do I delete my account?',
    a: 'Settings → Privacy & Data → Delete account. Deletion has a 7-day grace period during which you can change your mind. If you have actions still inside a longer undo window, deletion is scheduled after the latest window expires — so undo keeps working for its full window.',
    link: { href: '/privacy', label: 'Data retention and deletion →' },
  },
  {
    id: 'autopilot-modes',
    q: 'What is the difference between Autopilot’s Observe and Active modes?',
    a: 'Autopilot rules are presets you enable, and every rule starts in Observe mode: it collects what it would have done without acting on anything. After the 7-day observe window you review the matches and decide. Switching a rule to Active — so it applies to new matching mail without per-batch approval — is part of Pro; on Plus, matches keep waiting for your batch approval. You can pause a rule at any time.',
  },
  {
    id: 'pricing-tiers',
    q: 'What do the plans include?',
    // Derived from the pricing config (A3) — no plan number is written
    // here, so retuning the ladder cannot strand this answer.
    a: `Free includes Senders, Triage, Later, and every cleanup action, with ${TIER_MANIFEST.free.cleanupActionsPerMonth} actions each month. Plus removes the monthly limit and adds the Screener and Autopilot rules you approve batch by batch. Pro can run rules you turn on automatically and adds ${TIER_MANIFEST.pro.inboxLimit} inboxes and a ${TIER_MANIFEST.pro.undoWindowDays}-day Activity Undo window for Archive, Later, and Delete. Deleted email also stays in Gmail Trash for up to 30 days unless you empty Trash sooner. The pricing page has the current comparison.`,
    link: { href: '/pricing', label: 'Pricing →' },
  },
  {
    id: 'refunds',
    q: 'Is there a refund policy?',
    a: 'Yes — every paid plan comes with a 30-day money-back guarantee: tell us within 30 days of a charge and we refund it in full. You can also cancel anytime and keep access until the end of the period you paid for.',
    link: { href: '/refunds', label: 'See the refund policy for full terms →' },
  },
  {
    id: 'contact-support',
    q: 'How do I reach support?',
    a: 'Email support@declutrmail.com — we reply within 2 business days. Privacy and data requests go to privacy@declutrmail.com.',
    link: { href: '/contact', label: 'Contact →' },
  },
];

/**
 * schema.org FAQPage mirroring the rendered Q&A verbatim (Google
 * requires the marked-up answers to appear on the page) — same
 * construction as the landing FAQ's JSON-LD.
 */
const FAQ_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map(({ q, a, link }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: link ? `${a} <a href="${siteUrl()}${link.href}">${link.label}</a>` : a,
    },
  })),
};

const TOC = FAQS.map(({ id, q }) => ({ id, label: q }));

export default function HelpPage() {
  return (
    <LegalPageLayout title="Help & FAQ" label="Help" lastUpdated={LAST_UPDATED} toc={TOC}>
      <PageViewTracker page="help" />
      <JsonLd data={FAQ_JSON_LD} />
      {FAQS.map(({ id, q, a, link }) => (
        <LegalSection key={id} id={id} title={q}>
          <p>
            {a}
            {link ? (
              <>
                {' '}
                <a href={link.href}>{link.label}</a>
              </>
            ) : null}
          </p>
        </LegalSection>
      ))}
      <p>
        Didn&rsquo;t find your answer? Email{' '}
        <a href="mailto:support@declutrmail.com">support@declutrmail.com</a> or see the{' '}
        <a href="/contact">contact page</a>.
      </p>
    </LegalPageLayout>
  );
}
