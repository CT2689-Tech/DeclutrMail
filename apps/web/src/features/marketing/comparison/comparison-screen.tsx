import { OAUTH_SCOPE_DISCLOSURE } from '@declutrmail/shared';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { JsonLd } from '../json-ld';
import { TrackedCta } from '../landing/tracked-cta';
import { oauthStartUrl, siteUrl } from '../landing/urls';
import {
  ALTERNATIVES_SLUGS,
  comparisonBySlug,
  COMPARISONS,
  COMPARISONS_VERIFIED_FLOOR_ISO,
  comparisonVerifiedLabel,
  ROUNDUP_DIMENSIONS,
  type ComparisonCell,
  type ComparisonDefinition,
  type EvidenceState,
} from './comparison-data';

/**
 * Spelled from `COMPARISONS`, never hand-written. Three places said
 * "Five" while the array held six — under a badge reading "Official
 * primary sources only", which is the worst possible page to be
 * countably wrong on. Deriving it means adding a comparison cannot
 * leave the prose behind.
 */
const COMPARISON_COUNT_WORD =
  ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][
    COMPARISONS.length
  ] ?? String(COMPARISONS.length);

/**
 * Slug → display name, for the matrix's stacked mobile layout: below
 * 900px the header row is hidden and each cell carries its own column
 * name, so a value is never orphaned from the tool it describes.
 */
const COMPARISON_NAME_BY_SLUG: Readonly<Record<string, string>> = Object.fromEntries(
  COMPARISONS.map((comparison) => [comparison.slug, comparison.name]),
);

const STATE_LABEL: Readonly<Record<EvidenceState, string>> = {
  supported: 'Published',
  limited: 'Limited',
  'not-supported': 'Not offered',
  unknown: 'Not publicly stated',
  native: 'Native',
};

function EvidenceCell({ cell }: { cell: ComparisonCell }) {
  return (
    <div className="dm-compare-cell">
      <span className={`dm-compare-state dm-compare-state-${cell.state}`}>
        {STATE_LABEL[cell.state]}
      </span>
      <strong>{cell.summary}</strong>
      {cell.detail ? <p>{cell.detail}</p> : null}
    </div>
  );
}

export function VerificationStamp({ iso }: { iso: string }) {
  return (
    <p className="dm-compare-verified">
      <span aria-hidden="true">●</span> {comparisonVerifiedLabel(iso)} · Official primary sources
      only
    </p>
  );
}

export function MethodNote() {
  return (
    <aside className="dm-compare-method" aria-labelledby="comparison-method-title">
      <p className="dm-mkt-eyebrow">How we compare</p>
      <h2 id="comparison-method-title">Specific beats sweeping.</h2>
      <p>
        Competitor claims come from the company&rsquo;s own product, help, pricing, and privacy
        pages. &ldquo;Not publicly stated&rdquo; means those reviewed pages did not answer the
        question; it is not a claim that the feature does not exist. DeclutrMail facts reflect the
        current product and tier manifest. There are no affiliate links or paid placements here.
      </p>
    </aside>
  );
}

export function FinalCta({ competitorName }: { competitorName?: string }) {
  return (
    <section className="dm-compare-final" aria-labelledby="comparison-final-title">
      <p className="dm-mkt-eyebrow">Try the workflow</p>
      <h2 id="comparison-final-title">
        {competitorName
          ? `Still deciding between ${competitorName} and DeclutrMail?`
          : 'The right cleanup method is the one you will keep using.'}
      </h2>
      <p>
        Connect one Gmail inbox, review every sender, and use{' '}
        {TIER_MANIFEST.free.cleanupActionsPerMonth} cleanup actions a month on Free. Full message
        bodies and attachments are not fetched.
      </p>
      <div className="dm-mkt-hero-ctas">
        <TrackedCta
          href={oauthStartUrl()}
          className="dm-mkt-cta dm-mkt-cta-primary"
          cta="connect_gmail"
          placement="final"
        >
          Connect Gmail <span aria-hidden="true">→</span>
        </TrackedCta>
        <TrackedCta
          href="/pricing"
          className="dm-mkt-cta dm-mkt-cta-ghost"
          cta="see_pricing"
          placement="final"
        >
          See every tier
        </TrackedCta>
      </div>
      <p className="dm-mkt-hero-note">{OAUTH_SCOPE_DISCLOSURE}</p>
    </section>
  );
}

const INDEX_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'DeclutrMail email-cleanup comparisons',
  itemListElement: COMPARISONS.map((comparison, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: comparison.title,
    url: `${siteUrl()}/vs/${comparison.slug}`,
  })),
};

export function ComparisonIndexScreen() {
  return (
    <div className="dm-mkt dm-compare">
      <JsonLd data={INDEX_JSON_LD} />
      <div>
        <section className="dm-mkt-shell dm-compare-index-hero">
          <div>
            <p className="dm-mkt-hero-kicker">
              <b>Compare honestly</b> · No affiliate rankings
            </p>
            <h1 className="dm-mkt-h1">
              Email cleanup tools solve <em>different problems.</em>
            </h1>
            <p className="dm-mkt-hero-sub">
              DeclutrMail is a Gmail cleanup companion that shows the scope of a manual move before
              it runs. These comparisons show where focused unsubscribers, learned sorters, broad
              cleanup suites, and Gmail&rsquo;s own filters are genuinely stronger—and where
              DeclutrMail fits.
            </p>
          </div>
          <div className="dm-compare-index-note">
            <VerificationStamp iso={COMPARISONS_VERIFIED_FLOOR_ISO} />
            <strong>
              {COMPARISON_COUNT_WORD.charAt(0).toUpperCase() + COMPARISON_COUNT_WORD.slice(1)}{' '}
              direct comparisons
            </strong>
            <p>
              Every page links to the exact official sources used. Unknowns stay unknown instead of
              becoming convenient checkmarks.
            </p>
          </div>
        </section>

        <section
          className="dm-mkt-shell dm-compare-index-section"
          aria-labelledby="compare-list-title"
        >
          <p className="dm-mkt-eyebrow">Pick the closest alternative</p>
          <h2 id="compare-list-title" className="dm-mkt-h2">
            {COMPARISON_COUNT_WORD.charAt(0).toUpperCase() + COMPARISON_COUNT_WORD.slice(1)}{' '}
            different approaches to the same inbox.
          </h2>
          <div className="dm-compare-card-grid">
            {COMPARISONS.map((comparison, index) => (
              <article className="dm-compare-card" key={comparison.slug}>
                <div className="dm-compare-card-topline">
                  <span>0{index + 1}</span>
                  <span>{comparison.category}</span>
                </div>
                <h3>DeclutrMail vs {comparison.name}</h3>
                <p>{comparison.indexSummary}</p>
                <dl>
                  <div>
                    <dt>Organizes by</dt>
                    <dd>{comparison.primaryUnit}</dd>
                  </div>
                  <div>
                    <dt>Works with</dt>
                    <dd>{comparison.providerScope}</dd>
                  </div>
                  <div>
                    <dt>How to start</dt>
                    <dd>{comparison.publicEntryPoint}</dd>
                  </div>
                </dl>
                <a
                  href={`/vs/${comparison.slug}`}
                  aria-label={`Compare DeclutrMail and ${comparison.name}`}
                >
                  Read the comparison <span aria-hidden="true">→</span>
                </a>
              </article>
            ))}
          </div>
        </section>

        <section
          className="dm-mkt-shell dm-compare-index-section"
          aria-labelledby="alternatives-list-title"
        >
          <p className="dm-mkt-eyebrow">Looking for a roundup instead</p>
          <h2 id="alternatives-list-title" className="dm-mkt-h2">
            Every tool, from the other tool&rsquo;s side.
          </h2>
          <p className="dm-compare-matrix-lede">
            Each page below starts from a specific tool and lists what every alternative — including
            DeclutrMail — is actually for, using that tool&rsquo;s own words. No page ranks itself
            first.
          </p>
          <div className="dm-compare-card-grid">
            {ALTERNATIVES_SLUGS.map((slug, index) => {
              const subject = comparisonBySlug(slug);
              if (!subject) return null;
              return (
                <article className="dm-compare-card" key={slug}>
                  <div className="dm-compare-card-topline">
                    <span>0{index + 1}</span>
                    <span>{subject.category}</span>
                  </div>
                  <h3>Alternatives to {subject.name}</h3>
                  <p>What to use instead of {subject.name}, and when to stay.</p>
                  <a href={`/alternatives/${slug}`} aria-label={`Alternatives to ${subject.name}`}>
                    See the alternatives <span aria-hidden="true">→</span>
                  </a>
                </article>
              );
            })}
          </div>
        </section>

        <section
          className="dm-mkt-shell dm-compare-index-section"
          aria-labelledby="quick-scan-title"
        >
          <p className="dm-mkt-eyebrow">Quick scan</p>
          <h2 id="quick-scan-title" className="dm-mkt-h2">
            Start with the job, not the logo.
          </h2>
          <div
            className="dm-compare-quick-table-wrap"
            role="region"
            aria-label="Scrollable comparison summary"
            tabIndex={0}
          >
            <table className="dm-compare-quick-table">
              <caption className="dm-compare-sr-only">
                Primary job, supported mailboxes, and starting point for {COMPARISON_COUNT_WORD}{' '}
                DeclutrMail alternatives
              </caption>
              <thead>
                <tr>
                  <th scope="col">Alternative</th>
                  <th scope="col">Best for</th>
                  <th scope="col">Works with</th>
                  <th scope="col">How to start</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISONS.map((comparison) => (
                  <tr key={comparison.slug}>
                    <th scope="row">
                      <a href={`/vs/${comparison.slug}`}>{comparison.name}</a>
                    </th>
                    <td>{comparison.primaryUnit}</td>
                    <td>{comparison.providerScope}</td>
                    <td>{comparison.publicEntryPoint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <MatrixSection />

        <div className="dm-mkt-shell dm-compare-method-wrap">
          <MethodNote />
          <FinalCta />
        </div>
      </div>
    </div>
  );
}

/**
 * The multi-way matrix — every tool against every dimension in one view.
 *
 * WHY IT EXISTS. The three-way comparison on the retired `.ai` site was
 * the single best-converting page the product has ever had (4.08% CTR
 * against a site-wide 0.5%), and the format is absent here: `/compare`
 * shipped a descriptive table — what each tool is FOR — and seven 1v1
 * pages, but nothing that answers "how do these differ on the thing I
 * care about" without opening seven tabs.
 *
 * Every cell is the same object the `/vs/<slug>` page renders (see
 * `ROUNDUP_DIMENSIONS`), so this adds a view, not a claim. A competitor
 * that does not compare on a dimension renders as an explicit dash with
 * a screen-reader phrase, never as a blank a reader could read as "no".
 */
function MatrixSection() {
  return (
    <section className="dm-mkt-shell dm-compare-index-section" aria-labelledby="matrix-title">
      <p className="dm-mkt-eyebrow">Side by side</p>
      <h2 id="matrix-title" className="dm-mkt-h2">
        Every tool, every dimension, one table.
      </h2>
      <p className="dm-compare-matrix-lede">
        The same facts as the individual comparisons, turned sideways. Each column links to the full
        page and the official sources behind it.
      </p>
      <div
        className="dm-compare-quick-table-wrap"
        role="region"
        aria-label="Scrollable side-by-side comparison matrix"
        tabIndex={0}
      >
        <table className="dm-compare-quick-table dm-compare-matrix">
          <caption className="dm-compare-sr-only">
            DeclutrMail compared with {COMPARISON_COUNT_WORD} alternatives across{' '}
            {ROUNDUP_DIMENSIONS.length} dimensions. Cells marked not compared were not assessed on
            that alternative&rsquo;s page.
          </caption>
          <thead>
            <tr>
              <th scope="col">Dimension</th>
              <th scope="col">DeclutrMail</th>
              {COMPARISONS.map((comparison) => (
                <th scope="col" key={comparison.slug}>
                  <a href={`/vs/${comparison.slug}`}>{comparison.name}</a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROUNDUP_DIMENSIONS.map((dimension) => (
              <tr key={dimension.label}>
                <th scope="row">{dimension.label}</th>
                <td data-col="DeclutrMail">
                  <span
                    className={`dm-compare-state dm-compare-state-${dimension.declutrMail.state}`}
                  >
                    {STATE_LABEL[dimension.declutrMail.state]}
                  </span>
                  <strong>{dimension.declutrMail.summary}</strong>
                </td>
                {dimension.competitors.map(([slug, cell]) => (
                  <td key={slug} data-col={COMPARISON_NAME_BY_SLUG[slug]}>
                    {cell ? (
                      <>
                        <span className={`dm-compare-state dm-compare-state-${cell.state}`}>
                          {STATE_LABEL[cell.state]}
                        </span>
                        <strong>{cell.summary}</strong>
                      </>
                    ) : (
                      <span aria-hidden="true">&mdash;</span>
                    )}
                    {cell ? null : <span className="dm-compare-sr-only">Not compared</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function comparisonJsonLd(comparison: ComparisonDefinition) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: comparison.title,
    description: comparison.description,
    url: `${siteUrl()}/vs/${comparison.slug}`,
    dateModified: comparison.verifiedIso,
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl() },
        { '@type': 'ListItem', position: 2, name: 'Compare', item: `${siteUrl()}/compare` },
        {
          '@type': 'ListItem',
          position: 3,
          name: comparison.name,
          item: `${siteUrl()}/vs/${comparison.slug}`,
        },
      ],
    },
  };
}

export function ComparisonDetailScreen({ comparison }: { comparison: ComparisonDefinition }) {
  return (
    <div className="dm-mkt dm-compare">
      <JsonLd data={comparisonJsonLd(comparison)} />
      <div>
        <section className="dm-mkt-shell dm-compare-detail-hero">
          <nav className="dm-compare-breadcrumb" aria-label="Breadcrumb">
            <a href="/compare">All comparisons</a>
            <span aria-hidden="true">/</span>
            <span>{comparison.name}</span>
          </nav>
          <VerificationStamp iso={comparison.verifiedIso} />
          <p className="dm-mkt-hero-kicker">
            <b>{comparison.category}</b> · A direct comparison
          </p>
          <h1 className="dm-mkt-h1">
            DeclutrMail <em>vs</em> {comparison.name}
          </h1>
          <p className="dm-mkt-hero-sub">{comparison.verdict}</p>
          <div className="dm-mkt-hero-ctas">
            <a href="#differences" className="dm-mkt-cta dm-mkt-cta-primary">
              See the differences <span aria-hidden="true">↓</span>
            </a>
            <a href="#sources" className="dm-mkt-cta dm-mkt-cta-ghost">
              Inspect the sources
            </a>
          </div>
        </section>

        <section
          className="dm-mkt-shell dm-compare-choice-grid"
          aria-label="Which product fits whom"
        >
          <article className="dm-compare-choice dm-compare-choice-theirs">
            <p className="dm-compare-choice-label">A strong reason to choose {comparison.name}</p>
            <h2>{comparison.chooseCompetitor.headline}</h2>
            <ul>
              {comparison.chooseCompetitor.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </article>
          <article className="dm-compare-choice dm-compare-choice-ours">
            <p className="dm-compare-choice-label">A strong reason to choose DeclutrMail</p>
            <h2>{comparison.chooseDeclutrMail.headline}</h2>
            <ul>
              {comparison.chooseDeclutrMail.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </article>
        </section>

        <section
          id="differences"
          className="dm-mkt-shell dm-compare-table-section"
          aria-labelledby="differences-title"
        >
          <p className="dm-mkt-eyebrow">Side by side</p>
          <h2 id="differences-title" className="dm-mkt-h2">
            The differences that change the experience.
          </h2>
          <p className="dm-mkt-lede">
            Labels describe what the cited public sources actually establish. Read each note—the
            scope is usually more useful than a bare yes or no.
          </p>
          <div
            className="dm-compare-table-wrap"
            role="region"
            aria-label={`Scrollable comparison of DeclutrMail and ${comparison.name}`}
            tabIndex={0}
          >
            <table className="dm-compare-table">
              <caption className="dm-compare-sr-only">
                Feature comparison between DeclutrMail and {comparison.name}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Decision</th>
                  <th scope="col">DeclutrMail</th>
                  <th scope="col">{comparison.name}</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>
                      <EvidenceCell cell={row.declutrMail} />
                    </td>
                    <td>
                      <EvidenceCell cell={row.competitor} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section
          id="sources"
          className="dm-mkt-shell dm-compare-sources"
          aria-labelledby="sources-title"
        >
          <div>
            <p className="dm-mkt-eyebrow">Primary sources</p>
            <h2 id="sources-title" className="dm-mkt-h2">
              Check the evidence yourself.
            </h2>
            <p className="dm-mkt-lede">
              Product pages change. These links are the official pages reviewed for this comparison.
            </p>
          </div>
          <ol>
            {comparison.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url}>{source.label}</a>
                <p>{source.note}</p>
              </li>
            ))}
            <li>
              <a href="/pricing">DeclutrMail pricing and tiers</a>
              <p>Current public plan prices, inbox limits, capabilities, and undo windows.</p>
            </li>
            <li>
              <a href="/privacy">DeclutrMail privacy policy</a>
              <p>Current data categories, Gmail access, retention, and account-deletion details.</p>
            </li>
          </ol>
          <VerificationStamp iso={comparison.verifiedIso} />
        </section>

        <div className="dm-mkt-shell dm-compare-method-wrap">
          <MethodNote />
          <FinalCta competitorName={comparison.name} />
        </div>

        <nav className="dm-mkt-shell dm-compare-more" aria-label="More comparisons">
          <span>Compare another approach</span>
          <div>
            {COMPARISONS.filter((candidate) => candidate.slug !== comparison.slug).map(
              (candidate) => (
                <a href={`/vs/${candidate.slug}`} key={candidate.slug}>
                  {candidate.name} →
                </a>
              ),
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}
