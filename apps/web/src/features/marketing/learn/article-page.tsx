import Link from 'next/link';
import { SenderWalkthrough } from '@/features/marketing/landing/sender-walkthrough';
import { TrustRow } from '@/features/marketing/trust/trust-row';
import { demoForTopic } from './journey-links';
import { JsonLd } from '@/features/marketing/json-ld';
import { siteUrl } from '@/features/marketing/landing/urls';
import { formatReadingDate, ReadingCta, ReadingLayout } from './learn-shell';
import type { LearnArticle, LearnCallout, SyntheticExample } from './types';

function SyntheticPanel({ example }: { example: SyntheticExample }) {
  return (
    <aside className="dm-read-example" aria-label={example.label}>
      <div className="dm-read-example-head">
        <p className="dm-read-example-label">{example.label}</p>
        <p>{example.caption}</p>
      </div>
      {example.rows.map((row) => (
        <div className="dm-read-example-row" key={`${row.sender}-${row.action}`}>
          <div>
            <strong>{row.sender}</strong>
            <small>{row.detail}</small>
          </div>
          <div>
            <span className="dm-read-example-verb">{row.action}</span>
            <small>{row.result}</small>
          </div>
        </div>
      ))}
    </aside>
  );
}

function Callout({ callout }: { callout: LearnCallout }) {
  const tone = callout.tone === 'warning' ? ' dm-read-callout--warning' : '';
  return (
    <aside className={`dm-read-callout${tone}`}>
      <h3>{callout.title}</h3>
      <p>{callout.body}</p>
    </aside>
  );
}

/** The visible breadcrumb above the title; the BreadcrumbList mirrors it. */
function articleBreadcrumb(article: LearnArticle): { href: string; label: string } {
  if (article.kind === 'How-to guide') return { href: '/how-to', label: 'Guides' };
  if (article.kind === 'Direct answer') return { href: '/answers', label: 'Answers' };
  return { href: '/blog', label: 'Articles' };
}

function articleJsonLd(article: LearnArticle) {
  const url = `${siteUrl()}${article.path}`;
  // Every learn page uses the default share card (`app/opengraph-image.tsx`),
  // so the schema image is the same crawlable URL as og:image.
  const shared = {
    url,
    mainEntityOfPage: url,
    image: `${siteUrl()}/opengraph-image`,
    inLanguage: 'en-US',
    // Both HowTo and Article inherit CreativeWork's date properties, so the
    // freshness signal is identical on every branch.
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
  };

  if (article.kind === 'How-to guide') {
    const steps = article.sections.flatMap((section) => section.steps ?? []);
    return {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: article.title,
      description: article.description,
      ...shared,
      step: steps.map((step) => ({ '@type': 'HowToStep', name: step.name, text: step.text })),
    };
  }

  // The same organization node the marketing layout emits, by `@id`, with
  // the name and logo inline so the node stands alone for Article parsers.
  const organization = {
    '@type': 'Organization',
    '@id': `${siteUrl()}/#organization`,
    name: 'DeclutrMail',
    url: siteUrl(),
    logo: { '@type': 'ImageObject', url: `${siteUrl()}/icons/icon-512.png` },
  };
  return {
    '@context': 'https://schema.org',
    '@type': article.path.startsWith('/blog/') ? 'BlogPosting' : 'Article',
    headline: article.title,
    description: article.description,
    ...shared,
    author: organization,
    publisher: organization,
  };
}

function breadcrumbJsonLd(article: LearnArticle) {
  const parent = articleBreadcrumb(article);
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl() },
      { '@type': 'ListItem', position: 2, name: parent.label, item: `${siteUrl()}${parent.href}` },
      {
        '@type': 'ListItem',
        position: 3,
        name: article.title,
        item: `${siteUrl()}${article.path}`,
      },
    ],
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
  const examples = (
    <>
      {article.example ? <SyntheticPanel example={article.example} /> : null}
      {[
        'clean-gmail-by-sender',
        'bulk-delete-emails-from-one-sender',
        'gmail-storage-full',
        'is-it-safe-to-connect-gmail-app',
      ].includes(article.slug) ? (
        <SenderWalkthrough id={`guide-${article.slug}`} headingLevel={2} />
      ) : null}
    </>
  );
  return (
    <ReadingLayout
      breadcrumb={articleBreadcrumb(article)}
      title={article.title}
      lede={article.intro}
      meta={
        <>
          <span>{article.readingMinutes} minute read</span>
          <span>
            Updated <time dateTime={article.updatedAt}>{formatReadingDate(article.updatedAt)}</time>
          </span>
        </>
      }
      toc={article.sections.map(({ id, title }) => ({ id, label: title }))}
      tocNarrow="hidden"
    >
      <JsonLd data={articleJsonLd(article)} />
      <JsonLd data={breadcrumbJsonLd(article)} />
      {faq ? <JsonLd data={faq} /> : null}

      {article.quickAnswer ? (
        <section
          className="dm-read-callout dm-read-callout--answer"
          aria-labelledby="quick-answer-label"
        >
          <p className="dm-read-callout-label" id="quick-answer-label">
            Short answer
          </p>
          <p id="quick-answer">{article.quickAnswer}</p>
        </section>
      ) : null}

      {article.slug === 'is-it-safe-to-connect-gmail-app' ? <TrustRow /> : null}

      {article.kind !== 'How-to guide' ? examples : null}

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
            <ol className="dm-read-steps">
              {section.steps.map((step) => (
                <li key={step.name}>
                  <h3>{step.name}</h3>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
          ) : null}
          {section.callout ? <Callout callout={section.callout} /> : null}
        </section>
      ))}

      {article.kind === 'How-to guide' ? examples : null}

      {article.sources?.length ? (
        <section aria-labelledby="primary-sources">
          <h2 id="primary-sources">Verify the native Gmail behavior</h2>
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
        <h2 id="continue-reading">Keep reading</h2>
        <ul className="dm-read-related">
          {article.related.map((link) => (
            <li key={link.href}>
              <Link href={link.href}>{link.label}</Link>
              <span>{link.description}</span>
            </li>
          ))}
        </ul>
      </section>

      <ReadingCta demo={demoForTopic(article.slug)} />
    </ReadingLayout>
  );
}
