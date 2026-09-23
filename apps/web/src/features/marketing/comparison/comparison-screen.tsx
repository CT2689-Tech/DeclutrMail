import { demoForTopic } from '../learn/journey-links';
import { OAUTH_SCOPE_DISCLOSURE } from '@declutrmail/shared';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { JsonLd } from '../json-ld';
import { TrackedCta } from '../landing/tracked-cta';
import { permissionEntryUrl, siteUrl } from '../landing/urls';
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
      {comparisonVerifiedLabel(iso)}. Official primary sources only.
    </p>
  );
}

export function MethodNote() {
  return (
    <aside className="dm-compare-method" aria-labelledby="comparison-method-title">
      <h2 id="comparison-method-title">How we compare</h2>
      <p>
        Competitor claims come from the company&rsquo;s own product, help, pricing, and privacy
        pages. &ldquo;Not publicly stated&rdquo; means those reviewed pages did not answer the
        question; it is not a claim that the feature does not exist. DeclutrMail facts reflect the
        current product and tier manifest. There are no affiliate links or paid placements here.
      </p>
    </aside>
  );
}

export function FinalCta({
  competitorName,
  topic = 'senders',
}: {
  competitorName?: string;
  topic?: string;
}) {
  const demo = demoForTopic(topic);
  return (
    <section className="dm-compare-final" aria-labelledby="comparison-final-title">
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
      <div className="dm-story-actions">
        <TrackedCta href={demo.href} className="dm-story-link" cta="try_demo" placement="final">
          {demo.label}
        </TrackedCta>
        <TrackedCta
          href={permissionEntryUrl()}
          className="dm-story-button dm-story-button-primary"
          cta="connect_gmail"
          placement="final"
        >
          Start free
        </TrackedCta>
        <TrackedCta href="/pricing" className="dm-story-link" cta="see_pricing" placement="final">
          See every tier
        </TrackedCta>
      </div>
      <details className="dm-story-scope">
        <summary>What Google will ask you to allow</summary>
        <p>{OAUTH_SCOPE_DISCLOSURE}</p>
      </details>
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

const capitalized = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

const QUICK_FITS = [
  {
    href: '/vs/trimbox',
    job: 'Subscriptions first',
    tool: 'Trimbox',
    description: 'A focused way to unsubscribe and clear old mail from a list.',
    action: 'Compare opt-out tools',
  },
  {
    href: '/vs/sanebox',
    job: 'Less incoming noise',
    tool: 'SaneBox',
    description: 'Learned sorting moves lower-priority mail into folders.',
    action: 'Compare ongoing sorting',
  },
  {
    href: '/vs/clean-email',
    job: 'Several email providers',
    tool: 'Clean Email',
    description: 'A broad cleanup suite with filters and automation.',
    action: 'Compare broader coverage',
  },
  {
    href: '/vs/gmail',
    job: 'Stay inside Gmail',
    tool: 'Gmail',
    description: 'Use native search, bulk actions, and subscription controls.',
    action: 'Compare the native path',
  },
] as const;

export function ComparisonIndexScreen() {
  return (
    <div className="dm-story dm-comparison">
      <JsonLd data={INDEX_JSON_LD} />
      <header className="dm-compare-hero dm-compare-narrow">
        <h1>Email cleanup tools solve different problems.</h1>
        <p className="dm-compare-lede">
          DeclutrMail is a Gmail cleanup companion that shows the scope of a manual move before it
          runs. These comparisons show where focused unsubscribers, learned sorters, broad cleanup
          suites, and Gmail&rsquo;s own filters are genuinely stronger, and where DeclutrMail fits.
        </p>
        <p className="dm-compare-verified">
          {capitalized(COMPARISON_COUNT_WORD)} direct comparisons. No affiliate rankings.{' '}
          {comparisonVerifiedLabel(COMPARISONS_VERIFIED_FLOOR_ISO)}; every page links to the exact
          official sources used.
        </p>
      </header>

      <section
        className="dm-compare-section dm-compare-narrow"
        aria-labelledby="comparison-intent-title"
      >
        <h2 id="comparison-intent-title">Which job matters most?</h2>
        <p className="dm-compare-section-lede">
          Start with the kind of change you want. The detailed pages show where each tool is
          stronger and link to the sources behind the claims.
        </p>
        <div className="dm-compare-fit-grid">
          <div className="dm-compare-fit-feature">
            <span className="dm-compare-fit-kicker">Existing Gmail backlog</span>
            <h3>See the scope before you move mail.</h3>
            <p>
              DeclutrMail lets you review a sender, preview the current match and planned Gmail
              change, then check the outcome in Activity.
            </p>
            <a href="/inbox-simulator?workspace=senders">
              Try a sender review <span aria-hidden="true">→</span>
            </a>
          </div>
          <div className="dm-compare-fit-options">
            {QUICK_FITS.map((fit) => (
              <a key={fit.href} href={fit.href} aria-label={`${fit.action}: ${fit.tool}`}>
                <span className="dm-compare-fit-kicker">{fit.job}</span>
                <strong>{fit.tool}</strong>
                <span className="dm-compare-fit-description">{fit.description}</span>
                <span className="dm-compare-fit-action">
                  {fit.action} <span aria-hidden="true">→</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>
      <section
        className="dm-compare-section dm-compare-narrow"
        aria-labelledby="compare-list-title"
      >
        <h2 id="compare-list-title">Head to head</h2>
        <ul className="dm-compare-list dm-compare-index-list">
          {COMPARISONS.map((comparison) => (
            <li key={comparison.slug}>
              <span className="dm-compare-list-category">{comparison.category}</span>
              <a
                href={`/vs/${comparison.slug}`}
                aria-label={`Compare DeclutrMail and ${comparison.name}`}
              >
                DeclutrMail vs {comparison.name} <span aria-hidden="true">→</span>
              </a>
              <p>{comparison.indexSummary}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="dm-compare-section dm-compare-narrow"
        aria-labelledby="alternatives-list-title"
      >
        <h2 id="alternatives-list-title">Alternatives to a specific tool</h2>
        <p className="dm-compare-section-lede">
          Each page starts from one tool and lists what every alternative, including DeclutrMail, is
          for, in that tool&rsquo;s own words. No page ranks itself first.
        </p>
        <ul className="dm-compare-list">
          {ALTERNATIVES_SLUGS.map((slug) => {
            const subject = comparisonBySlug(slug);
            if (!subject) return null;
            return (
              <li key={slug}>
                <a href={`/alternatives/${slug}`} aria-label={`Alternatives to ${subject.name}`}>
                  Alternatives to {subject.name}
                </a>
                <p>What to use instead of {subject.name}, and when to stay.</p>
              </li>
            );
          })}
        </ul>
      </section>

      <MatrixSection />

      <div className="dm-compare-narrow">
        <MethodNote />
      </div>
      <FinalCta />
    </div>
  );
}

/**
 * The multi-way matrix — every tool against every dimension in one view.
 *
 * WHY IT EXISTS. The three-way comparison on the retired `.ai` site was
 * the single best-converting page the product has ever had (4.08% CTR
 * against a site-wide 0.5%). Every cell is the same object the
 * `/vs/<slug>` page renders (see `ROUNDUP_DIMENSIONS`), so this adds a
 * view, not a claim. A competitor that does not compare on a dimension
 * renders as an explicit dash with a screen-reader phrase, never as a
 * blank a reader could read as "no".
 */
function MatrixSection() {
  return (
    <section className="dm-compare-section dm-compare-wide" aria-labelledby="matrix-title">
      <div className="dm-compare-narrow-inner">
        <h2 id="matrix-title">Every tool side by side</h2>
        <p className="dm-compare-section-lede">
          The same facts as the individual comparisons, turned sideways. Each column links to the
          full page and the official sources behind it.
        </p>
      </div>
      <details className="dm-compare-matrix-details">
        <summary>
          <span>Open the full comparison matrix</span>
          <small>
            {ROUNDUP_DIMENSIONS.length} dimensions · {COMPARISONS.length + 1} tools
          </small>
        </summary>
        <div
          className="dm-compare-table-wrap"
          role="region"
          aria-label="Scrollable side-by-side comparison matrix"
          tabIndex={0}
        >
          <table className="dm-compare-table dm-compare-matrix">
            <caption className="dm-story-sr-only">
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
                      {cell ? null : <span className="dm-story-sr-only">Not compared</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
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

/**
 * What the tool is, in plain labelled facts. A labelled list rather than
 * a sentence: these values are written as standalone facts, not clause
 * fillers, so a label plus the verbatim value reads correctly for every
 * tool and keeps the vendor's own words intact.
 */
export function ToolFacts({ tool }: { tool: ComparisonDefinition }) {
  return (
    <dl className="dm-compare-facts">
      <div>
        <dt>Organizes by</dt>
        <dd>{tool.primaryUnit}</dd>
      </div>
      <div>
        <dt>Works with</dt>
        <dd>{tool.providerScope}</dd>
      </div>
      <div>
        <dt>How to start</dt>
        <dd>{tool.publicEntryPoint}</dd>
      </div>
    </dl>
  );
}

export function ComparisonDetailScreen({ comparison }: { comparison: ComparisonDefinition }) {
  return (
    <div className="dm-story dm-comparison">
      <JsonLd data={comparisonJsonLd(comparison)} />
      <header className="dm-compare-hero dm-compare-narrow">
        <nav className="dm-compare-breadcrumb" aria-label="Breadcrumb">
          <a href="/compare">All comparisons</a>
          <span aria-hidden="true">/</span>
          <span>{comparison.name}</span>
        </nav>
        <h1>DeclutrMail vs {comparison.name}</h1>
        <p className="dm-compare-lede">{comparison.verdict}</p>
        <p className="dm-compare-verified">
          {comparisonVerifiedLabel(comparison.verifiedIso)}. Official primary sources only.{' '}
          <a href="#sources">Check the sources</a>
        </p>
      </header>

      <section className="dm-compare-section dm-compare-narrow" aria-labelledby="choice-title">
        <h2 id="choice-title" className="dm-story-sr-only">
          Which product fits whom
        </h2>
        <div className="dm-compare-choice">
          <div>
            <p className="dm-compare-choice-label">A strong reason to choose {comparison.name}</p>
            <h3>{comparison.chooseCompetitor.headline}</h3>
            <ul>
              {comparison.chooseCompetitor.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <ToolFacts tool={comparison} />
          </div>
          <div>
            <p className="dm-compare-choice-label">A strong reason to choose DeclutrMail</p>
            <h3>{comparison.chooseDeclutrMail.headline}</h3>
            <ul>
              {comparison.chooseDeclutrMail.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section
        id="differences"
        className="dm-compare-section dm-compare-narrow"
        aria-labelledby="differences-title"
      >
        <h2 id="differences-title">The differences that change the experience</h2>
        <p className="dm-compare-section-lede">
          Labels describe what the cited public sources actually establish. The note under each is
          usually more useful than a bare yes or no.
        </p>
        <div
          className="dm-compare-table-wrap"
          role="region"
          aria-label={`Scrollable comparison of DeclutrMail and ${comparison.name}`}
          tabIndex={0}
        >
          <table className="dm-compare-table dm-compare-duo">
            <caption className="dm-story-sr-only">
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
                  <td data-col="DeclutrMail">
                    <EvidenceCell cell={row.declutrMail} />
                  </td>
                  <td data-col={comparison.name}>
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
        className="dm-compare-section dm-compare-narrow"
        aria-labelledby="sources-title"
      >
        <h2 id="sources-title">Sources</h2>
        <p className="dm-compare-section-lede">
          Product pages change. These are the official pages reviewed for this comparison.
        </p>
        <ol className="dm-compare-sources">
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
        <MethodNote />
      </section>

      <FinalCta competitorName={comparison.name} topic={comparison.slug} />

      <nav className="dm-compare-more dm-compare-narrow" aria-label="More comparisons">
        <h2>Compare another approach</h2>
        <ul>
          {COMPARISONS.filter((candidate) => candidate.slug !== comparison.slug).map(
            (candidate) => (
              <li key={candidate.slug}>
                <a href={`/vs/${candidate.slug}`}>DeclutrMail vs {candidate.name}</a>
              </li>
            ),
          )}
        </ul>
      </nav>
    </div>
  );
}
