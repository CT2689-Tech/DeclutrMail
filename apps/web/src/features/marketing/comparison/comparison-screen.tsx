import { JsonLd } from '../json-ld';
import { TrackedCta } from '../landing/tracked-cta';
import { oauthStartUrl, siteUrl } from '../landing/urls';
import {
  COMPARISONS,
  COMPARISON_VERIFIED_LABEL,
  type ComparisonCell,
  type ComparisonDefinition,
  type EvidenceState,
} from './comparison-data';

const STATE_LABEL: Readonly<Record<EvidenceState, string>> = {
  supported: 'Published',
  limited: 'Scope differs',
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

function VerificationStamp() {
  return (
    <p className="dm-compare-verified">
      <span aria-hidden="true">●</span> {COMPARISON_VERIFIED_LABEL} · Official primary sources only
    </p>
  );
}

function MethodNote() {
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

function FinalCta({ competitorName }: { competitorName?: string }) {
  return (
    <section className="dm-compare-final" aria-labelledby="comparison-final-title">
      <p className="dm-mkt-eyebrow">Try the workflow</p>
      <h2 id="comparison-final-title">
        {competitorName
          ? `Still deciding between ${competitorName} and DeclutrMail?`
          : 'The right cleanup method is the one you will keep using.'}
      </h2>
      <p>
        Connect one Gmail inbox, inspect the sender index, and use up to five cleanup actions on
        Free. Full message bodies and attachments are not fetched.
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
              DeclutrMail is a sender-first Gmail cleanup companion. These comparisons show where
              focused unsubscribers, learned sorters, broad cleanup suites, and Gmail&rsquo;s own
              filters are genuinely stronger—and where DeclutrMail fits.
            </p>
          </div>
          <div className="dm-compare-index-note">
            <VerificationStamp />
            <strong>Five direct comparisons</strong>
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
            Same inbox. Five different philosophies.
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
                    <dt>Primary unit</dt>
                    <dd>{comparison.primaryUnit}</dd>
                  </div>
                  <div>
                    <dt>Mailbox scope</dt>
                    <dd>{comparison.providerScope}</dd>
                  </div>
                  <div>
                    <dt>Public entry point</dt>
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
                Primary job, provider scope, and public entry point for five DeclutrMail
                alternatives
              </caption>
              <thead>
                <tr>
                  <th scope="col">Alternative</th>
                  <th scope="col">Best-shaped job</th>
                  <th scope="col">Mailbox scope</th>
                  <th scope="col">Public entry point</th>
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

        <div className="dm-mkt-shell dm-compare-method-wrap">
          <MethodNote />
          <FinalCta />
        </div>
      </div>
    </div>
  );
}

function comparisonJsonLd(comparison: ComparisonDefinition) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: comparison.title,
    description: comparison.description,
    url: `${siteUrl()}/vs/${comparison.slug}`,
    dateModified: '2026-07-11',
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
          <VerificationStamp />
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
          <VerificationStamp />
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
