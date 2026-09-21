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
 * shopping for a tool.
 *
 * THE PAGE DOES NOT RANK ITS ALTERNATIVES. The alternatives are listed
 * in the data's own order, each described by what it is FOR in its own
 * comparison's words, and DeclutrMail is one entry among several rather
 * than the answer. The "when to stay" section exists so the page is
 * still useful to a reader who should not switch at all.
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
    <div className="dm-story dm-comparison">
      <JsonLd data={jsonLd} />
      <header className="dm-compare-hero dm-compare-narrow">
        <nav className="dm-compare-breadcrumb" aria-label="Breadcrumb">
          <a href="/compare">All comparisons</a>
          <span aria-hidden="true">/</span>
          <span>{subject.name} alternatives</span>
        </nav>
        <h1>Looking past {subject.name}?</h1>
        <p className="dm-compare-lede">
          If {subject.name} is not the shape you need, here is what else exists, described by the
          job each one does, not ranked. DeclutrMail comes last, after the others.
        </p>
        <dl className="dm-compare-facts">
          <div>
            <dt>{subject.name} organizes by</dt>
            <dd>{subject.primaryUnit}</dd>
          </div>
          <div>
            <dt>Works with</dt>
            <dd>{subject.providerScope}</dd>
          </div>
        </dl>
        <VerificationStamp iso={verifiedIso} />
      </header>

      <section
        className="dm-compare-section dm-compare-narrow"
        aria-labelledby="alternatives-title"
      >
        <h2 id="alternatives-title">What each alternative is for</h2>
        <ul className="dm-compare-list dm-compare-list-detailed">
          {alternatives.map((alternative) => (
            <li key={alternative.slug}>
              <h3>{alternative.name}</h3>
              <p className="dm-compare-list-category">{alternative.category}</p>
              <p>{alternative.headline}</p>
              <ul className="dm-compare-points">
                {alternative.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <dl className="dm-compare-facts">
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
                Compare with DeclutrMail
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="dm-compare-section dm-compare-narrow" aria-labelledby="stay-title">
        <h2 id="stay-title">When {subject.name} is still the right answer</h2>
        <p className="dm-compare-section-lede">{subject.chooseCompetitor.headline}</p>
        <ul className="dm-compare-points">
          {subject.chooseCompetitor.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </section>

      <section className="dm-compare-section dm-compare-narrow" aria-labelledby="fit-title">
        <h2 id="fit-title">{subject.chooseDeclutrMail.headline}</h2>
        <ul className="dm-compare-points">
          {subject.chooseDeclutrMail.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <p className="dm-compare-section-lede">
          <a href={`/vs/${subject.slug}`}>Read the full {subject.name} comparison</a> or{' '}
          <a href="/compare">see every tool side by side</a>.
        </p>
        <MethodNote />
      </section>

      <FinalCta />
    </div>
  );
}
