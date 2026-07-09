import type { CSSProperties } from 'react';

import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';

import type { CompetitorPage } from './vs-data';

const LAST_UPDATED = '2026-07-09';

/**
 * Shared /vs/* page shell (D142–D144). Data comes from vs-data.ts so
 * the hub and individual pages cannot drift.
 */
export function VsPage({ competitor }: { competitor: CompetitorPage }) {
  const toc = [
    { id: 'choose', label: `Choose ${competitor.name} if…` },
    { id: 'wedge', label: 'Where DeclutrMail wins' },
    { id: 'compare', label: 'Feature comparison' },
    { id: 'next', label: 'Next steps' },
  ] as const;

  return (
    <LegalPageLayout
      title={`DeclutrMail vs ${competitor.name}`}
      label="Compare"
      lastUpdated={LAST_UPDATED}
      toc={toc}
    >
      <PageViewTracker page="vs" />

      <LegalSection id="choose" title={`Choose ${competitor.name} if…`}>
        <p>
          <strong>{competitor.chooseThemIf}</strong>
        </p>
        <p>
          This page is a buyer&rsquo;s guide, not a takedown. Competitor strengths are real; the
          question is whether they match how you want to clean Gmail.
        </p>
      </LegalSection>

      <LegalSection id="wedge" title="Where DeclutrMail wins">
        <p>{competitor.ourWedge}</p>
        <p>
          Privacy boundary (literal): <strong>Full bodies fetched: 0</strong>. Every destructive
          action shows a preview before it runs. See the <a href="/methodology">methodology</a> and{' '}
          <a href="/security">security</a> pages for the full trust story.
        </p>
      </LegalSection>

      <LegalSection id="compare" title="Feature comparison">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                <th style={th}>Capability</th>
                <th style={th}>DeclutrMail</th>
                <th style={th}>{competitor.name}</th>
              </tr>
            </thead>
            <tbody>
              {competitor.rows.map((row) => (
                <tr key={row.id}>
                  <td style={tdLabel}>{row.label}</td>
                  <td style={td}>{row.declutr}</td>
                  <td style={td}>{row.competitor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection id="next" title="Next steps">
        <p>
          <a href="/compare">All comparisons →</a>
          {' · '}
          <a href="/pricing">Pricing →</a>
          {' · '}
          <a href="/inbox-simulator">Try the demo →</a>
          {' · '}
          <a href="/help">Help →</a>
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}

const th: CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '1px solid #e5e5e0',
  fontWeight: 600,
  verticalAlign: 'bottom',
};

const td: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #eee',
  verticalAlign: 'top',
  lineHeight: 1.45,
};

const tdLabel: CSSProperties = {
  ...td,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};
