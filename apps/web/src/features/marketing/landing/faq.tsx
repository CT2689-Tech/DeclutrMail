import {
  ACTION_SAFETY_SUMMARY,
  AI_PROCESSING_DISCLOSURE,
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_STORAGE_ITEMS,
} from '@declutrmail/shared';

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
    a: `The published Gmail message-field disclosure lists ${PRIVACY_STORAGE_ITEMS.slice(0, 3).join(', ')}, dates, labels, and read/unread state. The headline is literal — ${PRIVACY_BADGE_HEADLINE}. The privacy policy separately covers operational records. Full message bodies, attachments, and raw MIME are never fetched.`,
    link: { href: '/privacy', label: 'Privacy policy →' },
  },
  {
    q: 'Does it read my emails?',
    a: `DeclutrMail never fetches full message bodies. It stores metadata plus the short preview snippet Gmail itself shows in your inbox list. ${AI_PROCESSING_DISCLOSURE}`,
  },
  {
    q: 'Can it mess up my inbox?',
    a: ACTION_SAFETY_SUMMARY,
  },
  {
    q: 'How is this different from Gmail filters?',
    a: 'Filters are rules you write directly in Gmail. DeclutrMail gives you a sender-ranked review, a live count-and-sample preview, and an activity record. The worker re-checks Gmail when a manual action executes, so the final count can change if the inbox changes in between. Manual Archive, Later, and Delete do not create future-mail rules; Pro Autopilot handles future matches only through presets you explicitly enable.',
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
      <p className="dm-mkt-eyebrow">№ 08 — Questions</p>
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
