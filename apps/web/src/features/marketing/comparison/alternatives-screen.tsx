import { JsonLd } from '../json-ld';
import { siteUrl } from '../landing/urls';
import type { AlternativesPage } from './comparison-data';
import { FinalCta, MethodNote, VerificationStamp } from './comparison-screen';

/**
 * The "X alternatives" page.
 *
 * These queries are the one intent class this product has ever
 * converted on: the retired site's three-way comparison took 4.08% CTR
 * while every how-to page it published took zero across 825
 * impressions. Someone searching "Clean Email alternatives" is already
 * shopping for a tool. Someone searching "how to unsubscribe" is trying
 * to finish a task and close the tab.
 *
 * THE PAGE DOES NOT RANK ITS ALTERNATIVES. The roundups currently
 * winning these SERPs place their own product at number one — one of
 * them titles itself an honest comparison and does exactly that. Here
 * the alternatives are listed alphabetically by the data's own order,
 * each described by what it is FOR in its own comparison's words, and
 * DeclutrMail is one entry among several rather than the answer. The
 * "when to stay" section exists so the page is still useful to a reader
 * who should not switch at all.
 *
 * Every fact renders from an existing `ComparisonDefinition`, so this
 * page adds no claim that `/vs/<slug>` does not already carry with its
 * sources.
 */
export function AlternativesScreen({ page }: { page: AlternativesPage }) {
  const { subject, alternatives, verifiedIso } = page;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${subject.name} alternatives`,
    description: `Source-backed alternatives to ${subject.name} for email cleanup, listed by what each one is for.`,
    dateModified: verifiedIso,
    itemListElement: alternatives.map((alternative, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: alternative.name,
      url: `${siteUrl()}/vs/${alternative.slug}`,
    })),
  };

  return (
    <div className="dm-mkt dm-compare">
      <JsonLd data={jsonLd} />
      <div>
        <section className="dm-mkt-shell dm-compare-index-hero">
          <div>
            <p className="dm-mkt-hero-kicker">
              <b>{subject.name} alternatives</b> · No affiliate rankings
            </p>
            <h1 className="dm-mkt-h1">
              Looking past <em>{subject.name}?</em>
            </h1>
            <p className="dm-mkt-hero-sub">
              If {subject.name} is not the shape you need, here is what else exists — described by
              the job each one does, not ranked.
            </p>
            {/*
             * A labelled list, not a sentence.
             *
             * Two earlier drafts failed on the same thing: these values are
             * written as standalone facts, not clause fillers. Lowercasing
             * them for prose produced "works with major providers and imap",
             * and dropping them into "It works with: …" produced "It works
             * with: Gmail is clearly documented." A label plus the verbatim
             * value reads correctly for every tool, and keeps the vendor's
             * own words intact — which is the whole basis of these pages.
             */}
            <dl className="dm-alt-subject-facts">
              <div>
                <dt>Organizes by</dt>
                <dd>{subject.primaryUnit}</dd>
              </div>
              <div>
                <dt>Works with</dt>
                <dd>{subject.providerScope}</dd>
              </div>
            </dl>
          </div>
          <div className="dm-compare-index-note">
            <VerificationStamp iso={verifiedIso} />
            <strong>Nobody is placed first</strong>
            <p>
              DeclutrMail is one entry below, not the answer. Every claim links to the
              company&rsquo;s own documentation, and unknowns stay unknown.
            </p>
          </div>
        </section>

        <section
          className="dm-mkt-shell dm-compare-index-section"
          aria-labelledby="alternatives-title"
        >
          <p className="dm-mkt-eyebrow">Start with the job</p>
          <h2 id="alternatives-title" className="dm-mkt-h2">
            What each alternative is actually for.
          </h2>
          <div className="dm-compare-card-grid">
            {alternatives.map((alternative) => (
              <article className="dm-compare-card" key={alternative.slug}>
                <div className="dm-compare-card-topline">
                  <span>{alternative.category}</span>
                </div>
                <h3>{alternative.name}</h3>
                <p>{alternative.headline}</p>
                <ul className="dm-alt-points">
                  {alternative.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                <dl>
                  <div>
                    <dt>Organizes by</dt>
                    <dd>{alternative.primaryUnit}</dd>
                  </div>
                  <div>
                    <dt>Works with</dt>
                    <dd>{alternative.providerScope}</dd>
                  </div>
                  <div>
                    <dt>How to start</dt>
                    <dd>{alternative.publicEntryPoint}</dd>
                  </div>
                </dl>
                <a
                  href={`/vs/${alternative.slug}`}
                  aria-label={`Compare DeclutrMail and ${alternative.name}`}
                >
                  Compare with DeclutrMail <span aria-hidden="true">→</span>
                </a>
              </article>
            ))}
          </div>
        </section>

        {/*
         * The section a self-serving roundup would never publish. If the
         * reader's job is the one the subject already does well, the
         * useful answer is to stay — and saying so is the only reason to
         * believe the rest of the page.
         */}
        <section className="dm-mkt-shell dm-compare-index-section" aria-labelledby="stay-title">
          <p className="dm-mkt-eyebrow">Before you switch</p>
          <h2 id="stay-title" className="dm-mkt-h2">
            When {subject.name} is still the right answer.
          </h2>
          <div className="dm-alt-stay">
            <p>{subject.chooseCompetitor.headline}</p>
            <ul>
              {subject.chooseCompetitor.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="dm-mkt-shell dm-compare-index-section" aria-labelledby="fit-title">
          <p className="dm-mkt-eyebrow">Where DeclutrMail fits</p>
          <h2 id="fit-title" className="dm-mkt-h2">
            {subject.chooseDeclutrMail.headline}
          </h2>
          <div className="dm-alt-stay">
            <ul>
              {subject.chooseDeclutrMail.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <p>
              <a href={`/vs/${subject.slug}`}>
                Read the full {subject.name} comparison <span aria-hidden="true">→</span>
              </a>{' '}
              or <a href="/compare">see every tool side by side</a>.
            </p>
          </div>
        </section>

        <div className="dm-mkt-shell dm-compare-method-wrap">
          <MethodNote />
          <FinalCta />
        </div>
      </div>
    </div>
  );
}
