import Link from 'next/link';
import { SupportTasks } from './support-tasks';
import { JsonLd } from '@/features/marketing/json-ld';
import { siteUrl } from '@/features/marketing/landing/urls';
import { BLOG_ARTICLES, BLOG_SLUGS } from './blog-content';
import { CHANGELOG_ENTRIES } from './changelog-content';
import { FAQ_ENTRIES } from './faq-content';
import { ANSWERS_HUB, HOW_TO_HUB, type LearnHubDefinition } from './hub-content';
import { formatReadingDate, ReadingCta, ReadingLayout } from './learn-shell';
import type { LearnArticle } from './types';

function ArticleList({ articles, label }: { articles: readonly LearnArticle[]; label: string }) {
  return (
    <ul className="dm-read-list" aria-label={label}>
      {articles.map((article) => (
        <li key={article.slug}>
          <Link href={article.path}>
            <span className="dm-read-list-title">{article.title}</span>
            <span className="dm-read-list-desc">{article.description}</span>
            <span className="dm-read-list-meta">{article.readingMinutes} minute read</span>
          </Link>
        </li>
      ))}
    </ul>
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
  const { heading, lead, meta, path, description, articles, label } = hub;
  return (
    <ReadingLayout
      title={heading}
      lede={lead}
      meta={meta.map((item) => (
        <span key={item}>{item}</span>
      ))}
    >
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
      <ArticleList articles={articles} label={label} />
    </ReadingLayout>
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
    <ReadingLayout
      title="Notes on calmer, inspectable email"
      lede="First-party essays about decisions by sender, privacy boundaries, recovery, and the design trade-offs behind a Gmail companion."
      meta={
        <>
          <span>{articles.length} launch essays</span>
          <span>No sponsored posts</span>
        </>
      }
    >
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Blog',
          name: 'DeclutrMail articles',
          url: `${siteUrl()}/blog`,
          blogPost: articles.map((article) => ({
            '@type': 'BlogPosting',
            headline: article.title,
            url: `${siteUrl()}${article.path}`,
          })),
        }}
      />
      <ArticleList articles={articles} label="DeclutrMail articles" />
      {/* The how-to and answer clusters used to be listed in full here,
          because the footer's "Guides" link landed on /blog and they had
          no hub of their own. They now have one each, so this is two
          pointers instead of twenty duplicated rows — the hub stays the
          canonical entry point for its cluster, and the essays are not
          buried under content they have nothing to do with. Every field
          reads off the hub definition (`meta[0]` is its cluster count) so
          this pointer cannot describe a hub the hub does not describe. */}
      <section aria-labelledby="other-hubs">
        <h2 id="other-hubs">Guides and answers</h2>
        <ul className="dm-read-list" aria-label="Other learning hubs">
          {[HOW_TO_HUB, ANSWERS_HUB].map((hub) => (
            <li key={hub.path}>
              <Link href={hub.path}>
                <span className="dm-read-list-title">{hub.heading}</span>
                <span className="dm-read-list-desc">{hub.description}</span>
                <span className="dm-read-list-meta">{hub.meta[0]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </ReadingLayout>
  );
}

export function FaqPage() {
  return (
    <ReadingLayout
      title="Questions worth answering before Gmail access"
      lede="What is stored, what each action changes, where recovery stops, and how DeclutrMail fits beside Gmail. No universal-undo shorthand."
    >
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
      <SupportTasks />
      <section className="dm-read-faq" aria-label="Frequently asked questions">
        {FAQ_ENTRIES.map((entry, index) => (
          <details key={entry.id} id={entry.id} open={index === 0}>
            <summary>{entry.question}</summary>
            <div className="dm-read-faq-answer">
              <p>{entry.answer}</p>
              {entry.link ? (
                <p>
                  <Link href={entry.link.href}>{entry.link.label}</Link>
                </p>
              ) : null}
            </div>
          </details>
        ))}
      </section>
      <ReadingCta />
    </ReadingLayout>
  );
}

export function ChangelogPage() {
  return (
    <ReadingLayout
      title="What changed, and when"
      lede="DeclutrMail does not use public version numbers yet, so updates are listed by the date they shipped rather than under invented release names. Every entry describes a change you can see in the product — it is not a promise that every account has received a rollout."
      meta={<Link href="/changelog/rss.xml">RSS feed</Link>}
    >
      <nav className="dm-support-tasks" aria-label="Explore product updates">
        <Link href="/how-it-works">
          Review the current workflow
          <small>See what changes in Gmail and what stays under your control</small>
        </Link>
        <Link href="/help">
          Find help with a change<small>Recovery, connections and subscription support</small>
        </Link>
      </nav>
      <section className="dm-read-log" aria-label="Product update history">
        {CHANGELOG_ENTRIES.map((entry) => (
          <article key={entry.id} id={entry.id}>
            <time dateTime={entry.date}>{formatReadingDate(entry.date)}</time>
            <div className="dm-read-log-entry">
              <h2>{entry.title}</h2>
              <p>{entry.summary}</p>
              <p>
                <Link
                  href={
                    /payment|plan|rupees|tier/i.test(entry.title)
                      ? '/pricing'
                      : /access|deletion/i.test(entry.title)
                        ? '/security'
                        : '/how-it-works'
                  }
                >
                  Explore this part of the product →
                </Link>
              </p>
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
            </div>
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
    </ReadingLayout>
  );
}
