import Link from 'next/link';
import { JsonLd } from '@/features/marketing/json-ld';
import { siteUrl } from '@/features/marketing/landing/urls';
import { LearnEyebrow, LearnShell } from './learn-shell';
import type { LearnArticle, LearnCallout, SyntheticExample } from './types';

function SyntheticPanel({ example }: { example: SyntheticExample }) {
  return (
    <aside className="dm-learn-example" aria-label={example.label}>
      <div className="dm-learn-example-head">
        <div className="dm-learn-example-label">{example.label}</div>
        <p>{example.caption}</p>
      </div>
      {example.rows.map((row) => (
        <div className="dm-learn-example-row" key={`${row.sender}-${row.action}`}>
          <div>
            <strong>{row.sender}</strong>
            <small>{row.detail}</small>
          </div>
          <div className="dm-learn-action">
            <b>{row.action}</b>
            <small>{row.result}</small>
          </div>
        </div>
      ))}
    </aside>
  );
}

function Callout({ callout }: { callout: LearnCallout }) {
  const tone = callout.tone ?? 'info';
  return (
    <aside className={`dm-learn-callout dm-learn-callout--${tone}`}>
      <h3>{callout.title}</h3>
      <p>{callout.body}</p>
    </aside>
  );
}

function articleJsonLd(article: LearnArticle) {
  // Both HowTo and Article inherit CreativeWork's date properties, so the
  // freshness signal is identical on either branch.
  const dates = { datePublished: article.publishedAt, dateModified: article.updatedAt };

  if (article.kind === 'How-to guide') {
    const steps = article.sections.flatMap((section) => section.steps ?? []);
    return {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: article.title,
      description: article.description,
      url: `${siteUrl()}${article.path}`,
      ...dates,
      step: steps.map((step) => ({ '@type': 'HowToStep', name: step.name, text: step.text })),
    };
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    url: `${siteUrl()}${article.path}`,
    ...dates,
    author: { '@type': 'Organization', name: 'DeclutrMail' },
    publisher: { '@type': 'Organization', name: 'DeclutrMail' },
  };
}

/**
 * A second node marking up the one question the page exists to answer, so
 * an answer engine can lift the response without parsing the prose.
 *
 * Emitted only when the title is literally interrogative and a short
 * answer exists — the pair IS the Question/Answer, so nothing here is
 * restated or invented. `/answers/sender-level-vs-message-level-cleanup`
 * is titled as a comparison rather than a question and correctly gets no
 * FAQPage; a page whose title stops being a question loses the node, and
 * the content test pins how many pages currently qualify.
 */
function faqJsonLd(article: LearnArticle) {
  if (!article.quickAnswer || !article.title.endsWith('?')) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: article.title,
        acceptedAnswer: { '@type': 'Answer', text: article.quickAnswer },
      },
    ],
  };
}

export function ArticlePage({ article }: { article: LearnArticle }) {
  const faq = faqJsonLd(article);
  return (
    <LearnShell>
      <JsonLd data={articleJsonLd(article)} />
      {faq ? <JsonLd data={faq} /> : null}
      <header className={`dm-learn-hero${article.example ? '' : ' dm-learn-hero--solo'}`}>
        <div>
          <LearnEyebrow>{article.eyebrow}</LearnEyebrow>
          <h1 className="dm-learn-title">{article.title}</h1>
          <p className="dm-learn-lead">{article.intro}</p>
          <div className="dm-learn-meta">
            <span>{article.kind}</span>
            <span aria-hidden="true">·</span>
            <span>{article.readingMinutes} minute read</span>
          </div>
        </div>
        {article.example ? <SyntheticPanel example={article.example} /> : null}
      </header>

      <article className="dm-learn-prose">
        {article.quickAnswer ? (
          <section className="dm-learn-quick" aria-labelledby="quick-answer">
            <LearnEyebrow>Short answer</LearnEyebrow>
            <p id="quick-answer">{article.quickAnswer}</p>
          </section>
        ) : null}

        {article.sections.map((section) => (
          <section key={section.id} id={section.id}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.bullets ? (
              <ul>
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : null}
            {section.steps ? (
              <ol className="dm-learn-steps">
                {section.steps.map((step) => (
                  <li key={step.name}>
                    <div className="dm-learn-step-copy">
                      <h3>{step.name}</h3>
                      <p>{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
            {section.callout ? <Callout callout={section.callout} /> : null}
          </section>
        ))}

        {article.sources?.length ? (
          <section aria-labelledby="primary-sources">
            <LearnEyebrow>Primary sources</LearnEyebrow>
            <h2 id="primary-sources" style={{ marginTop: 12 }}>
              Verify the native Gmail behavior
            </h2>
            <p>
              Gmail controls and wording can change. These guides were checked against Google’s
              current help documentation.
            </p>
            <ul>
              {article.sources.map((source) => (
                <li key={source.href}>
                  <a href={source.href} rel="noreferrer">
                    {source.label}
                  </a>{' '}
                  — {source.description}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="continue-reading">
          <LearnEyebrow>Continue reading</LearnEyebrow>
          <h2 id="continue-reading" style={{ marginTop: 12 }}>
            Make the next decision with context
          </h2>
          <div className="dm-learn-related">
            {article.related.map((link) => (
              <Link href={link.href} key={link.href}>
                <strong>{link.label}</strong>
                <span>{link.description}</span>
              </Link>
            ))}
          </div>
        </section>
      </article>
    </LearnShell>
  );
}
