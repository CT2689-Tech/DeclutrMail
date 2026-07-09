import type { Metadata } from 'next';

import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Blog — DeclutrMail',
  description:
    'DeclutrMail blog — Gmail cleanup notes, privacy explainers, and product updates. Posts land here over time; start with Help, Methodology, and the Changelog.',
  path: '/blog',
});

const LAST_UPDATED = '2026-07-09';

const TOC = [
  { id: 'status', label: 'Status' },
  { id: 'read-now', label: 'Read now' },
] as const;

/**
 * Thin blog index shell (D132 Tier 5). Empty on purpose at launch —
 * populated organically. Points readers at live trust/docs surfaces.
 */
export default function BlogPage() {
  return (
    <LegalPageLayout title="Blog" label="Blog" lastUpdated={LAST_UPDATED} toc={TOC}>
      <PageViewTracker page="blog" />

      <LegalSection id="status" title="Status">
        <p>
          The blog index is live; individual posts will appear here as we publish. Until then, the
          best sources of truth are Help, Methodology, and the Changelog.
        </p>
      </LegalSection>

      <LegalSection id="read-now" title="Read now">
        <p>
          <a href="/help">Help &amp; FAQ →</a>
          {' · '}
          <a href="/methodology">Methodology →</a>
          {' · '}
          <a href="/changelog">Changelog →</a>
          {' · '}
          <a href="/answers/is-it-safe-to-connect-gmail-app">Is it safe to connect Gmail? →</a>
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
