import { JsonLd } from '@/features/marketing/json-ld';
import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { siteUrl } from '@/features/marketing/landing/urls';

import type { AnswerPage as AnswerPageData } from './answers-data';

const LAST_UPDATED = '2026-07-09';

export function AnswerPageView({ page }: { page: AnswerPageData }) {
  const toc = [
    { id: 'answer', label: 'Answer' },
    { id: 'details', label: 'Details' },
    { id: 'related', label: 'Related' },
  ] as const;

  const fullAnswer = [page.answer, ...page.body].join(' ');
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: page.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `${fullAnswer} <a href="${siteUrl()}${page.path}">${page.question}</a>`,
        },
      },
    ],
  };

  return (
    <LegalPageLayout title={page.question} label="Answers" lastUpdated={LAST_UPDATED} toc={toc}>
      <PageViewTracker page="answers" />
      <JsonLd data={faqLd} />

      <LegalSection id="answer" title="Answer">
        <p>{page.answer}</p>
      </LegalSection>

      <LegalSection id="details" title="Details">
        {page.body.map((para) => (
          <p key={para.slice(0, 48)}>{para}</p>
        ))}
      </LegalSection>

      <LegalSection id="related" title="Related">
        <p>
          {page.related.map((link, i) => (
            <span key={link.href}>
              {i > 0 ? ' · ' : null}
              <a href={link.href}>{link.label} →</a>
            </span>
          ))}
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
