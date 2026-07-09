import type { Metadata } from 'next';

import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { COMPETITORS } from '@/features/marketing/growth/vs-data';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Compare DeclutrMail — vs Clean Email, SaneBox, and more',
  description:
    'Honest buyer’s guides: DeclutrMail vs Clean Email, Trimbox, SaneBox, Leave Me Alone, and Gmail Filters — with “choose them if…” callouts.',
  path: '/compare',
});

const LAST_UPDATED = '2026-07-09';

const TOC = [
  { id: 'how-we-differ', label: 'How we differ' },
  { id: 'guides', label: 'Comparison guides' },
  { id: 'try', label: 'Try before you connect' },
] as const;

export default function ComparePage() {
  return (
    <LegalPageLayout title="Compare" label="Compare" lastUpdated={LAST_UPDATED} toc={TOC}>
      <PageViewTracker page="compare" />

      <LegalSection id="how-we-differ" title="How we differ">
        <p>
          DeclutrMail is a <strong>Gmail-only, sender-level</strong> cleanup product. You decide
          once per sender — Keep, Archive, Unsubscribe, Later, or Delete — with a mandatory preview
          and a plan-tied undo window. Privacy is literal: <strong>Full bodies fetched: 0</strong>.
        </p>
        <p>
          Other tools win on multi-provider support, one-time cleanup pricing, years of maturity, or
          free DIY filters. The guides below say so up front.
        </p>
      </LegalSection>

      <LegalSection id="guides" title="Comparison guides">
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {COMPETITORS.map((c) => (
            <li
              key={c.slug}
              style={{
                marginBottom: 16,
                paddingBottom: 16,
                borderBottom: '1px solid #eee',
              }}
            >
              <a href={c.path} style={{ fontWeight: 600, fontSize: 16 }}>
                DeclutrMail vs {c.name} →
              </a>
              <p style={{ margin: '6px 0 0', color: '#555', lineHeight: 1.5 }}>{c.blurb}</p>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: '#777' }}>
                <em>{c.chooseThemIf}</em>
              </p>
            </li>
          ))}
        </ul>
      </LegalSection>

      <LegalSection id="try" title="Try before you connect">
        <p>
          Privacy-anxious? Practice the verbs in the <a href="/inbox-simulator">inbox simulator</a>{' '}
          (no signup), then read the <a href="/methodology">methodology</a> or{' '}
          <a href="/pricing">pricing</a>.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
