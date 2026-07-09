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
import { PRIVACY_BADGE_HEADLINE, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';
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

const LAST_UPDATED = '2026-07-08';

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
    a: `Exactly this list, and nothing more: ${PRIVACY_STORAGE_ITEMS.join('; ')}. The trust line is literal — ${PRIVACY_BADGE_HEADLINE}. Full message bodies, attachments, inline images, and raw MIME are never fetched or stored.`,
    link: { href: '/privacy', label: 'Privacy policy →' },
  },
  {
    id: 'unsubscribe-flow',
    q: 'How does Unsubscribe work?',
    a: 'Where a sender supports the one-click unsubscribe standard (Gmail’s list-unsubscribe), DeclutrMail sends the unsubscribe request for you and tracks the result. Where a sender only offers a mailto: unsubscribe address, we prepare the email and you send it yourself from Gmail — nothing is auto-sent on your behalf. Unsubscribe stops future mail; nothing already in your inbox moves.',
  },
  {
    id: 'bulk-unsubscribe',
    q: 'Can I unsubscribe from all my newsletters at once?',
    a: 'There is no single “unsubscribe from everything” button — DeclutrMail ranks your senders by how much they email you so you can clear the noisiest first, deciding once per sender. Paid plans add bulk cleanup: select many senders and unsubscribe across them in one pass, with the same preview before anything runs. For each sender, where it supports one-click unsubscribe we send the request for you; where it only offers a mailto: address we prepare the email for you to send from Gmail — nothing is ever auto-sent on your behalf.',
    link: { href: '/pricing', label: 'Compare plans →' },
  },
  {
    id: 'verbs-in-gmail-terms',
    q: 'What do Archive, Later, and Delete actually do in Gmail?',
    a: 'Archive removes the messages from your inbox — Gmail keeps them in All Mail, searchable as ever. Later moves them out of the inbox into a DeclutrMail/Later label so you can come back to them. Delete moves them to Gmail’s Trash, where Gmail keeps them recoverable for about 30 days before deleting permanently. Keep leaves everything where it is.',
  },
  {
    id: 'undo-windows',
    q: 'What can I undo, and for how long?',
    a: 'Every action shows a preview of exactly what will move before anything runs, and every action is journaled with an undo window — 7 days on Free and Plus, 30 days on Pro. Undo restores the exact state the action changed.',
  },
  {
    id: 'disconnect-mailbox',
    q: 'How do I disconnect a mailbox?',
    a: 'Settings → Mailboxes → Disconnect. That revokes DeclutrMail’s Google access and stops all syncing and actions for that mailbox immediately; your historical activity log is kept so you can reconnect later. You can also revoke access directly from your Google account permissions page.',
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
    a: 'Autopilot rules are presets you enable, and every rule starts in Observe mode: it collects what it would have done without acting on anything. After the 7-day observe window you review the matches and decide whether to switch the rule to Active, which applies the rule to new matching mail. You can pause a rule at any time.',
  },
  {
    id: 'pricing-tiers',
    q: 'What do the plans include?',
    a: 'Free shows you what’s noisy and lets you clean up sender by sender. Paid plans add bulk cleanup across senders and, on Pro, the 30-day undo window. The pricing page has the current comparison.',
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
