import { PRIVACY_BADGE_HEADLINE, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';

import { JsonLd } from '../json-ld';
import { siteUrl } from './urls';

/**
 * FAQ teaser (D134 §9, questions curated from D137).
 *
 * Six of the ten D137 questions — the trust-critical ones. Answers are
 * 2–4 sentences with links to the deeper pages. Native
 * <details>/<summary> so the section works with zero JS.
 *
 * Answers are plain strings (plus an optional trailing link) so ONE
 * source feeds both the rendered copy and the FAQPage JSON-LD emitted
 * alongside it (D132 SEO batch) — parallel copies are how the two
 * would drift apart.
 *
 * The privacy answer quotes the D228 locked copy module rather than
 * paraphrasing it — paraphrases are how banned phrasings sneak in.
 */

const FAQS: ReadonlyArray<{ q: string; a: string; link?: { href: string; label: string } }> = [
  {
    q: 'What does DeclutrMail actually see in my Gmail?',
    a: `Exactly what the trust badge says: ${PRIVACY_STORAGE_ITEMS.slice(0, 3).join(', ')}, dates, labels, and read/unread state. The headline is literal — ${PRIVACY_BADGE_HEADLINE}. Full message bodies, attachments, and raw MIME are never fetched.`,
    link: { href: '/privacy', label: 'Privacy policy →' },
  },
  {
    q: 'Does it read my emails?',
    a: 'No. We index metadata plus the short preview snippet Gmail itself shows in your inbox list — enough to rank senders, not enough to read your mail. There is no AI summarising of message content, because the content is never there.',
  },
  {
    q: 'Can it mess up my inbox?',
    a: 'Every action shows a preview of exactly what will move before anything runs, and every action is journaled with an undo window — 7 days on Free and Plus, 30 on Pro. Archive and Delete map to Gmail’s own archive and trash, so nothing is ever unrecoverable behind your back.',
  },
  {
    q: 'How is this different from Gmail filters?',
    a: 'Filters are per-rule plumbing you write and forget; DeclutrMail is a per-sender ritual with a ledger. You decide once per sender, the decision keeps running on new mail, and every consequence is visible and reversible in one place.',
  },
  {
    q: 'What happens if I disconnect or delete my account?',
    a: 'Disconnecting stops all syncing and actions immediately. Deleting your account schedules a purge of everything we stored — the deletion date respects any undo windows still open, so your safety net outlives your subscription.',
  },
  {
    q: 'Is there a refund policy?',
    a: 'Yes — every paid plan comes with a 30-day money-back guarantee: tell us within 30 days of a charge and we refund it in full.',
    link: { href: '/refunds', label: 'See the refund policy for full terms →' },
  },
];

/**
 * schema.org FAQPage mirroring the rendered Q&A verbatim (Google
 * requires the marked-up answers to appear on the page). Links become
 * absolute anchors — schema.org Answer.text allows them.
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

export function Faq() {
  return (
    <section className="dm-mkt-section dm-mkt-shell">
      <JsonLd data={FAQ_JSON_LD} />
      <p className="dm-mkt-eyebrow">№ 06 — Questions</p>
      <h2 className="dm-mkt-h2">Asked, answered.</h2>
      <div className="dm-mkt-faq">
        {FAQS.map(({ q, a, link }) => (
          <details key={q}>
            <summary>{q}</summary>
            <p className="dm-mkt-faq-a">
              {a}
              {link ? (
                <>
                  {' '}
                  <a href={link.href}>{link.label}</a>
                </>
              ) : null}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
