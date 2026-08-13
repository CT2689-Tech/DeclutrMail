import Link from 'next/link';
import { JsonLd } from '@/features/marketing/json-ld';
import { siteUrl } from '@/features/marketing/landing/urls';
import { ANSWER_SLUGS } from './answer-content';
import { BLOG_ARTICLES, BLOG_SLUGS } from './blog-content';
import { CHANGELOG_ENTRIES } from './changelog-content';
import { FAQ_ENTRIES } from './faq-content';
import { HOW_TO_SLUGS } from './how-to-content';
import { ANSWERS_HUB, HOW_TO_HUB, type LearnHubDefinition } from './hub-content';
import { LearnEyebrow, LearnShell } from './learn-shell';
import type { LearnArticle } from './types';

function ArticleCards({ articles, label }: { articles: readonly LearnArticle[]; label: string }) {
  return (
    <section className="dm-learn-grid" aria-label={label}>
      {articles.map((article) => (
        <Link className="dm-learn-card" href={article.path} key={article.slug}>
          <em>{article.eyebrow}</em>
          <strong>{article.title}</strong>
          <span>{article.description}</span>
          <span>{article.readingMinutes} minute read</span>
        </Link>
      ))}
    </section>
  );
}

/**
 * A hub for one content cluster (D132 how-to and answer sets).
 *
 * These exist because the ten pages built to rank were previously
 * reachable only through intra-cluster cross-links and a shared section on
 * `/blog` — so each cluster had no addressable entry point for a crawler,
 * an answer engine, or the footer to point at. The `ItemList` states the
 * cluster's membership and order explicitly rather than leaving it to be
 * inferred from the markup.
 */
function LearnHub({ hub }: { hub: LearnHubDefinition }) {
  const { eyebrow, heading, lead, meta, path, description, articles, label } = hub;
  return (
    <LearnShell>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: heading,
          description,
          url: `${siteUrl()}${path}`,
          isPartOf: { '@id': `${siteUrl()}/#website` },
          mainEntity: {
            '@type': 'ItemList',
            itemListOrder: 'https://schema.org/ItemListOrderAscending',
            numberOfItems: articles.length,
            itemListElement: articles.map((article, index) => ({
              '@type': 'ListItem',
              position: index + 1,
              name: article.title,
              url: `${siteUrl()}${article.path}`,
            })),
          },
        }}
      />
      <header className="dm-learn-hero dm-learn-hero--solo">
        <div>
          <LearnEyebrow>{eyebrow}</LearnEyebrow>
          <h1 className="dm-learn-title">{heading}</h1>
          <p className="dm-learn-lead">{lead}</p>
          <div className="dm-learn-meta">
            {meta.map((item, index) => (
              <span key={item}>
                {index > 0 ? <span aria-hidden="true">· </span> : null}
                {item}
              </span>
            ))}
          </div>
        </div>
      </header>
      <ArticleCards articles={articles} label={label} />
    </LearnShell>
  );
}

export function HowToIndexPage() {
  return <LearnHub hub={HOW_TO_HUB} />;
}

export function AnswersIndexPage() {
  return <LearnHub hub={ANSWERS_HUB} />;
}

export function BlogIndexPage() {
  const articles = BLOG_SLUGS.map((slug) => BLOG_ARTICLES[slug]);
  return (
    <LearnShell>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Blog',
          name: 'DeclutrMail Journal',
          url: `${siteUrl()}/blog`,
          blogPost: articles.map((article) => ({
            '@type': 'BlogPosting',
            headline: article.title,
            url: `${siteUrl()}${article.path}`,
          })),
        }}
      />
      <header className="dm-learn-hero dm-learn-hero--solo">
        <div>
          <LearnEyebrow>DeclutrMail journal</LearnEyebrow>
          <h1 className="dm-learn-title">Notes on calmer, inspectable email</h1>
          <p className="dm-learn-lead">
            First-party essays about sender-level decisions, privacy boundaries, recovery, and the
            design trade-offs behind a Gmail companion.
          </p>
          <div className="dm-learn-meta">
            <span>{articles.length} launch essays</span>
            <span aria-hidden="true">·</span>
            <span>No sponsored posts</span>
          </div>
        </div>
      </header>
      <ArticleCards articles={articles} label="Journal articles" />
      {/* The how-to and answer clusters used to be listed in full here,
          because the footer's "Guides" link landed on /blog and they had
          no hub of their own. They now have one each, so this is two
          pointers instead of twenty duplicated cards — the hub stays the
          canonical entry point for its cluster, and the essays are not
          buried under content they have nothing to do with. */}
      <header className="dm-learn-hero dm-learn-hero--solo">
        <div>
          <LearnEyebrow>Also on DeclutrMail</LearnEyebrow>
          <h2 className="dm-learn-title">Guides and answers</h2>
        </div>
      </header>
      <section className="dm-learn-grid" aria-label="Other learning hubs">
        <Link className="dm-learn-card" href="/how-to">
          <em>Step-by-step</em>
          <strong>Gmail cleanup how-to guides</strong>
          <span>
            The native Gmail method first, what it changes and leaves alone, and Google’s own
            documentation for every step.
          </span>
          <span>{HOW_TO_SLUGS.length} guides</span>
        </Link>
        <Link className="dm-learn-card" href="/answers">
          <em>Straight answers</em>
          <strong>Answers about Gmail cleanup</strong>
          <span>
            What a cleanup app can see, what each action changes, and where recovery stops — limits
            stated, not implied.
          </span>
          <span>{ANSWER_SLUGS.length} answers</span>
        </Link>
      </section>
    </LearnShell>
  );
}

export function FaqPage() {
  return (
    <LearnShell>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: FAQ_ENTRIES.map((entry) => ({
            '@type': 'Question',
            name: entry.question,
            acceptedAnswer: { '@type': 'Answer', text: entry.answer },
          })),
        }}
      />
      <header className="dm-learn-hero dm-learn-hero--solo">
        <div>
          <LearnEyebrow>Product FAQ · precise answers</LearnEyebrow>
          <h1 className="dm-learn-title">Questions worth answering before Gmail access</h1>
          <p className="dm-learn-lead">
            What is stored, what each action changes, where recovery stops, and how DeclutrMail fits
            beside Gmail. No universal-undo shorthand.
          </p>
        </div>
      </header>
      <section className="dm-learn-faq" aria-label="Frequently asked questions">
        {FAQ_ENTRIES.map((entry, index) => (
          <details key={entry.id} id={entry.id} open={index === 0}>
            <summary>{entry.question}</summary>
            <p>{entry.answer}</p>
            {entry.link ? (
              <p>
                <Link href={entry.link.href}>{entry.link.label} →</Link>
              </p>
            ) : null}
          </details>
        ))}
      </section>
    </LearnShell>
  );
}

export function ChangelogPage() {
  return (
    <LearnShell>
      <header className="dm-learn-hero dm-learn-hero--solo">
        <div>
          <LearnEyebrow>Product updates</LearnEyebrow>
          <h1 className="dm-learn-title">What changed, and when</h1>
          <p className="dm-learn-lead">
            DeclutrMail does not use public version numbers yet, so updates are listed by the date
            they shipped rather than under invented release names. Every entry describes a change
            you can see in the product — it is not a promise that every account has received a
            rollout.
          </p>
          <div className="dm-learn-meta">
            <Link href="/changelog/rss.xml">RSS feed</Link>
          </div>
        </div>
      </header>
      <section className="dm-learn-log" aria-label="Product update history">
        {CHANGELOG_ENTRIES.map((entry) => (
          <article key={entry.id} id={entry.id}>
            <LearnEyebrow>Update · {entry.date}</LearnEyebrow>
            <h2>{entry.title}</h2>
            <p>{entry.summary}</p>
            {entry.added.length ? (
              <>
                <h3>Added</h3>
                <ul>
                  {entry.added.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {entry.improved.length ? (
              <>
                <h3>Improved</h3>
                <ul>
                  {entry.improved.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {entry.fixed.length ? (
              <>
                <h3>Fixed</h3>
                <ul>
                  {entry.fixed.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {/*
              `entry.evidence` is deliberately NOT rendered. It stays in the
              data as build-time provenance so `pnpm check-changelog` can
              verify this page against git history — but pull-request numbers
              and commit hashes are internal, and every link to them would
              404 for the public the moment the repository goes private.
              Founder decision 2026-07-29.
            */}
          </article>
        ))}
      </section>
    </LearnShell>
  );
}
