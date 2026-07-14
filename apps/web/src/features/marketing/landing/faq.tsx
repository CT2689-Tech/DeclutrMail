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
    a: `The message fields DeclutrMail fetches and stores are: ${PRIVACY_STORAGE_ITEMS.join(', ')}. The headline is literal — ${PRIVACY_BADGE_HEADLINE}. Full message bodies, attachments, and raw MIME are never fetched.`,
    link: { href: '/privacy', label: 'Privacy policy →' },
  },
  {
    q: 'Does it read my emails?',
    a: 'DeclutrMail never fetches full message bodies. It indexes the listed Gmail fields, including subject and Gmail’s short Preview. When optional generated explanations or a Brief narrative are enabled, selected listed fields are sent to Anthropic’s API; the Privacy Policy names those fields and the processor retention terms.',
  },
  {
    q: 'Can it mess up my inbox?',
    a: "Mail-changing actions show a preview before they run. Archive, Later, and Delete use your plan's Activity Undo window. Gmail Trash recovery is separate and normally lasts up to 30 days. A delivered unsubscribe request cannot be recalled.",
  },
  {
    q: 'How is this different from Gmail filters?',
    a: 'Filters are rules you write and maintain. DeclutrMail groups mail by sender, previews each action, and records results in Activity along with any available undo.',
  },
  {
    q: 'What happens if I disconnect or delete my account?',
    a: 'Disconnecting removes DeclutrMail’s saved Google credential and stops syncing and new actions while keeping indexed history for reconnecting. Account deletion schedules removal of your account and mailbox product data after any protected undo window; narrowly scoped pseudonymous security and deletion evidence remains under the operational retention policy.',
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
