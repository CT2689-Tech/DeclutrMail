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
    // The FULL generated list, never a slice. A `slice(0, 3)` plus a
    // hand-written tail shipped here for a while: it published 6 of 11
    // fields under the words "the published disclosure", silently dropped
    // the Gmail preview snippet — the field our own /answers pages call
    // the honesty test — and desynced from the registry the moment its
    // order changed. This answer is also emitted as FAQPage JSON-LD, so
    // answer engines quote it detached from the /privacy link. Same
    // pattern as help/page.tsx:53.
    a: `${PRIVACY_BADGE_HEADLINE} DeclutrMail stores these Gmail details: ${PRIVACY_STORAGE_ITEMS.join('; ')}. The privacy policy separately explains the account, preferences, decisions, Activity history, and billing records needed to run the service.`,
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
    a: 'Filters are rules you write directly in Gmail. DeclutrMail groups email by sender, shows the affected count and a sample before you confirm, and records the result in Activity. The final count can change if new email arrives before the action runs. Archive, Later, and Delete do not create rules for future email. Autopilot is separate: only rules you deliberately turn on handle future email, you see what a rule would do before turning it on, and you can have one collect matches for your approval instead.',
  },
  {
    q: 'What happens if I disconnect or delete my account?',
    a: 'Disconnecting stops all syncing and actions immediately. Deleting your account schedules permanent deletion of everything we stored — the deletion date respects any undo windows still open, so your safety net outlives your subscription.',
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
