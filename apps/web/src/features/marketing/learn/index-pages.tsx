import Link from 'next/link';
import { JsonLd } from '@/features/marketing/json-ld';
import { siteUrl } from '@/features/marketing/landing/urls';
import { BLOG_ARTICLES, BLOG_SLUGS } from './blog-content';
import { CHANGELOG_ENTRIES, REPOSITORY_URL, changelogEvidenceUrl } from './changelog-content';
import { FAQ_ENTRIES } from './faq-content';
import { LearnEyebrow, LearnShell } from './learn-shell';

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
      <section className="dm-learn-grid" aria-label="Journal articles">
        {articles.map((article) => (
          <Link className="dm-learn-card" href={article.path} key={article.slug}>
            <em>{article.eyebrow}</em>
            <strong>{article.title}</strong>
            <span>{article.description}</span>
            <span>{article.readingMinutes} minute read</span>
          </Link>
        ))}
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
          <LearnEyebrow>Evidence-linked build log</LearnEyebrow>
          <h1 className="dm-learn-title">What changed, with the repository receipts</h1>
          <p className="dm-learn-lead">
            DeclutrMail does not have public semantic-version tags yet. This log mirrors user-facing
            changes in first-parent repository history instead of inventing release numbers. A
            merged change is evidence of the build, not a promise that every account has received a
            rollout.
          </p>
          <div className="dm-learn-meta">
            <Link href="/changelog/rss.xml">RSS feed</Link>
            <span aria-hidden="true">·</span>
            <a href={REPOSITORY_URL} rel="noreferrer">
              Source repository
            </a>
          </div>
        </div>
      </header>
      <section className="dm-learn-log" aria-label="Repository build history">
        {CHANGELOG_ENTRIES.map((entry) => (
          <article key={entry.id} id={entry.id}>
            <LearnEyebrow>Repository build · {entry.date}</LearnEyebrow>
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
            <div className="dm-learn-evidence" aria-label="Repository evidence">
              {entry.evidence.map((evidence) => (
                <a
                  href={changelogEvidenceUrl(evidence.pullRequest)}
                  key={evidence.commit}
                  rel="noreferrer"
                  title={`${evidence.summary} · commit ${evidence.commit}`}
                >
                  PR #{evidence.pullRequest} · {evidence.commit}
                </a>
              ))}
            </div>
          </article>
        ))}
      </section>
    </LearnShell>
  );
}
