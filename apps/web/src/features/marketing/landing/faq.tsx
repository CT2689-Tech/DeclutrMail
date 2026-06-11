import type { ReactNode } from 'react';

import { PRIVACY_BADGE_HEADLINE, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';

/**
 * FAQ teaser (D134 §9, questions curated from D137).
 *
 * Six of the ten D137 questions — the trust-critical ones. Answers are
 * 2–4 sentences with links to the deeper pages. Native
 * <details>/<summary> so the section works with zero JS.
 *
 * The privacy answer quotes the D228 locked copy module rather than
 * paraphrasing it — paraphrases are how banned phrasings sneak in.
 */

const FAQS: ReadonlyArray<{ q: string; a: ReactNode }> = [
  {
    q: 'What does DeclutrMail actually see in my Gmail?',
    a: (
      <>
        Exactly what the trust badge says: {PRIVACY_STORAGE_ITEMS.slice(0, 3).join(', ')}, dates,
        labels, and read/unread state. The headline is literal — {PRIVACY_BADGE_HEADLINE}. Full
        message bodies, attachments, and raw MIME are never fetched.{' '}
        <a href="/privacy">Privacy policy →</a>
      </>
    ),
  },
  {
    q: 'Does it read my emails?',
    a: (
      <>
        No. We index metadata plus the short preview snippet Gmail itself shows in your inbox list —
        enough to rank senders, not enough to read your mail. There is no AI summarising of message
        content, because the content is never there.
      </>
    ),
  },
  {
    q: 'Can it mess up my inbox?',
    a: (
      <>
        Every action shows a preview of exactly what will move before anything runs, and every
        action is journaled with an undo window — 7 days on Free and Plus, 30 on Pro. Archive and
        Delete map to Gmail&rsquo;s own archive and trash, so nothing is ever unrecoverable behind
        your back.
      </>
    ),
  },
  {
    q: 'How is this different from Gmail filters?',
    a: (
      <>
        Filters are per-rule plumbing you write and forget; DeclutrMail is a per-sender ritual with
        a ledger. You decide once per sender, the decision keeps running on new mail, and every
        consequence is visible and reversible in one place.
      </>
    ),
  },
  {
    q: 'What happens if I disconnect or delete my account?',
    a: (
      <>
        Disconnecting stops all syncing and actions immediately. Deleting your account schedules a
        purge of everything we stored — the deletion date respects any undo windows still open, so
        your safety net outlives your subscription.
      </>
    ),
  },
  {
    q: 'Is there a refund policy?',
    a: (
      <>
        Yes — 30-day money-back guarantee on every paid plan, no questions asked.{' '}
        <a href="/refunds">Refund policy →</a>
      </>
    ),
  },
];

export function Faq() {
  return (
    <section className="dm-mkt-section dm-mkt-shell">
      <p className="dm-mkt-eyebrow">№ 06 — Questions</p>
      <h2 className="dm-mkt-h2">Asked, answered.</h2>
      <div className="dm-mkt-faq">
        {FAQS.map(({ q, a }) => (
          <details key={q}>
            <summary>{q}</summary>
            <p className="dm-mkt-faq-a">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
