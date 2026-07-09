import { JsonLd } from '@/features/marketing/json-ld';
import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { siteUrl } from '@/features/marketing/landing/urls';

import type { HowToPage as HowToPageData } from './how-to-data';

const LAST_UPDATED = '2026-07-09';

export function HowToPage({ page }: { page: HowToPageData }) {
  const toc = [
    { id: 'answer', label: 'Short answer' },
    { id: 'steps', label: 'Steps' },
    { id: 'related', label: 'Related' },
  ] as const;

  const howToLd = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: page.title,
    description: page.answer,
    step: page.steps.map((step, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: step.name,
      text: step.text,
      url: `${siteUrl()}${page.path}#step-${i + 1}`,
    })),
  };

  return (
    <LegalPageLayout title={page.title} label="How-to" lastUpdated={LAST_UPDATED} toc={toc}>
      <PageViewTracker page="how_to" />
      <JsonLd data={howToLd} />

      <LegalSection id="answer" title="Short answer">
        <p>{page.answer}</p>
      </LegalSection>

      <LegalSection id="steps" title="Steps">
        <ol>
          {page.steps.map((step, i) => (
            <li key={step.name} id={`step-${i + 1}`} style={{ marginBottom: 12 }}>
              <strong>{step.name}.</strong> {step.text}
            </li>
          ))}
        </ol>
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
