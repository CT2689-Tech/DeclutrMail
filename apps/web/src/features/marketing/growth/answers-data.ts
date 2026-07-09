/**
 * Tier 4 AEO/GEO answer pages (D132). Question H1 + direct answer in the
 * first 40–60 words. One array feeds visible copy + FAQPage JSON-LD.
 */

import { PRIVACY_BADGE_HEADLINE, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';

export interface AnswerPage {
  slug: string;
  path: `/answers/${string}`;
  question: string;
  description: string;
  /** First 40–60 words — also the JSON-LD Answer.text lead. */
  answer: string;
  /** Supporting paragraphs after the lead. */
  body: readonly string[];
  related: ReadonlyArray<{ href: string; label: string }>;
}

export const ANSWER_PAGES: readonly AnswerPage[] = [
  {
    slug: 'is-it-safe-to-connect-gmail-app',
    path: '/answers/is-it-safe-to-connect-gmail-app',
    question: 'Is it safe to connect Gmail to DeclutrMail?',
    description:
      'Yes — DeclutrMail uses gmail.modify, stores metadata only (Full bodies fetched: 0), encrypts tokens, and previews every action before it runs.',
    answer: `Yes, if you accept a metadata-only Gmail cleanup tool. DeclutrMail’s trust line is literal — ${PRIVACY_BADGE_HEADLINE}. It uses the gmail.modify OAuth scope to act only on your instructions, envelope-encrypts tokens, and shows a preview before every Archive, Unsubscribe, Later, or Delete.`,
    body: [
      `What is stored: ${PRIVACY_STORAGE_ITEMS.join('; ')}. Full message bodies, attachments, inline images, and raw MIME are never fetched or stored.`,
      'You can disconnect a mailbox anytime (Settings → Mailboxes → Disconnect) or revoke access from your Google account. Account deletion has a grace period and respects open undo windows.',
      'Read the Security and Privacy pages for encryption, CASA, and Google Limited Use details.',
    ],
    related: [
      { href: '/security', label: 'Security' },
      { href: '/privacy', label: 'Privacy policy' },
      { href: '/methodology', label: 'Methodology' },
    ],
  },
  {
    slug: 'what-is-metadata-only-email-analysis',
    path: '/answers/what-is-metadata-only-email-analysis',
    question: 'What is metadata-only email analysis?',
    description:
      'Metadata-only means ranking and acting on senders using headers and Gmail snippets — never full message bodies. DeclutrMail’s boundary is Full bodies fetched: 0.',
    answer: `Metadata-only email analysis means the product indexes sender identity, subjects, Gmail’s short preview snippet, dates, labels, and read/unread state — not the full body. DeclutrMail states this as ${PRIVACY_BADGE_HEADLINE} and never fetches HTML, attachments, or raw MIME.`,
    body: [
      'That is enough to rank noisy senders and preview how many messages an Archive or Delete would move. It is not enough to summarize or “read” your mail with AI over body content — because the content is never there.',
      'Gmail’s own category labels may appear as read-only chrome; DeclutrMail does not predict newsletter/personal categories to auto-protect mail.',
    ],
    related: [
      { href: '/privacy', label: 'What we store' },
      { href: '/methodology', label: 'How we recommend' },
      { href: '/help#what-we-store', label: 'Help: storage' },
    ],
  },
  {
    slug: 'how-undo-works-for-gmail-cleanup',
    path: '/answers/how-undo-works-for-gmail-cleanup',
    question: 'How does undo work for Gmail cleanup?',
    description:
      'DeclutrMail journals every action with a plan-tied undo window — 7 days on Free/Plus, 30 on Pro — after a mandatory preview.',
    answer:
      'Undo for Gmail cleanup in DeclutrMail starts before the mutation: every Archive, Unsubscribe, Later, or Delete shows a preview of exact counts. After you confirm, the action is journaled and reversible for 7 days on Free and Plus, or 30 days on Pro.',
    body: [
      'Undo restores the state DeclutrMail changed. Gmail Trash also keeps deleted mail recoverable for about 30 days on Google’s side.',
      'Async actions like one-click unsubscribe use honest Activity copy: “requested” at intent time, “confirmed” only when the outcome is known.',
    ],
    related: [
      { href: '/help#undo-windows', label: 'Undo FAQ' },
      { href: '/pricing', label: 'Plan undo windows' },
      { href: '/inbox-simulator', label: 'Try the demo' },
    ],
  },
  {
    slug: 'best-way-to-clean-gmail-2026',
    path: '/answers/best-way-to-clean-gmail-2026',
    question: 'What is the best way to clean Gmail in 2026?',
    description:
      'Decide once per sender with preview and undo — not message-by-message thrash. DeclutrMail is built for that sender-level ritual.',
    answer:
      'The best way to clean Gmail in 2026 is sender-level cleanup: rank who emails you most, decide Keep / Archive / Unsubscribe / Later / Delete once per sender, preview impact, then keep an undo window. Message-by-message cleanup does not scale past a few hundred threads.',
    body: [
      'Native Gmail filters are free and powerful if you want to author rules yourself. DeclutrMail is for people who want a guided ritual, an Activity ledger, and metadata-only indexing.',
      'Practice the verbs in the no-signup inbox simulator before connecting Gmail if you are privacy-anxious.',
    ],
    related: [
      { href: '/how-to/clean-gmail-by-sender', label: 'How-to: clean by sender' },
      { href: '/vs/gmail-filters', label: 'vs Gmail Filters' },
      { href: '/compare', label: 'Compare tools' },
    ],
  },
  {
    slug: 'sender-level-vs-message-level-cleanup',
    path: '/answers/sender-level-vs-message-level-cleanup',
    question: 'Sender-level vs message-level email cleanup — which is better?',
    description:
      'Sender-level cleanup turns thousands of emails into a few hundred decisions. Message-level cleanup does not scale. DeclutrMail is sender-first.',
    answer:
      'Sender-level cleanup is better when your backlog is dominated by repeat senders: one Archive or Unsubscribe decision can clear hundreds of messages and future mail. Message-level cleanup is better for one-off threads you must read individually — it does not scale for promo and notification noise.',
    body: [
      'DeclutrMail is intentionally sender-first. You still see recent subjects in previews so you are not deciding blind — without storing full bodies.',
      'If you only need DIY rules inside Google, Gmail Filters remain free. If you want a ledger, preview, and undo across senders, use a sender-control product.',
    ],
    related: [
      { href: '/methodology', label: 'Methodology' },
      { href: '/vs/clean-email', label: 'vs Clean Email' },
      { href: '/help#getting-started', label: 'Getting started' },
    ],
  },
] as const;

export function answerBySlug(slug: string): AnswerPage | undefined {
  return ANSWER_PAGES.find((p) => p.slug === slug);
}
