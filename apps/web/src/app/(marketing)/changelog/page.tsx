// /changelog — thin D218 launch shell.
//
// Reverse-chronological milestones only — no invented semver, no RSS
// yet, no markdown pipeline. Future releases can move to
// `docs/changelog/` once Docs Agent owns the cadence (D218).
// Public marketing route: static prose, no auth round-trip.

import type { Metadata } from 'next';
import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Changelog — DeclutrMail',
  description:
    'What shipped in DeclutrMail: open beta, public marketing and legal pages, sender-level cleanup with preview and undo, and the privacy badge boundary.',
  path: '/changelog',
});

const LAST_UPDATED = '2026-07-09';

/**
 * Hardcoded launch milestones. Month-level dates only — do not invent
 * patch versions or day-precision ship dates without a release record.
 */
const ENTRIES = [
  {
    id: '2026-07-open-beta',
    date: 'July 2026',
    title: 'Open beta',
    summary:
      'DeclutrMail is in open beta. Sign in with Google and start cleaning up — no invite code or waitlist.',
    link: { href: '/beta', label: 'Open beta →' },
  },
  {
    id: '2026-07-marketing-legal',
    date: 'July 2026',
    title: 'Marketing, help, and legal surfaces',
    summary:
      'Public pages for pricing, help, security, privacy, terms, refunds, cookies, contact, and methodology — so the product boundary is readable before you connect Gmail.',
    link: { href: '/help', label: 'Help & FAQ →' },
  },
  {
    id: '2026-07-sender-cleanup',
    date: 'July 2026',
    title: 'Sender-level cleanup with preview and undo',
    summary:
      "Decide once per sender with Keep, Archive, Unsubscribe, Later, or Delete. Every action shows a preview before it runs and stays reversible for your plan's undo window.",
  },
  {
    id: '2026-07-privacy-badge',
    date: 'July 2026',
    title: 'Privacy badge: Full bodies fetched: 0',
    summary:
      'The trust badge states the storage allowlist and the never-store list in product UI — the same locked copy used on Security and Methodology.',
    link: { href: '/methodology', label: 'Methodology →' },
  },
] as const;

const TOC = ENTRIES.map(({ id, title }) => ({ id, label: title }));

export default function ChangelogPage() {
  return (
    <LegalPageLayout title="Changelog" label="Changelog" lastUpdated={LAST_UPDATED} toc={TOC}>
      <PageViewTracker page="changelog" />
      <p>
        A short public record of what has shipped. For how the product works day to day, see{' '}
        <a href="/help">Help</a>. For getting started during open beta, see <a href="/beta">Beta</a>
        .
      </p>
      {ENTRIES.map(({ id, date, title, summary, link }) => (
        <LegalSection key={id} id={id} title={title}>
          <p>
            <strong>{date}</strong>
          </p>
          <p>
            {summary}
            {link ? (
              <>
                {' '}
                <a href={link.href}>{link.label}</a>
              </>
            ) : null}
          </p>
        </LegalSection>
      ))}
    </LegalPageLayout>
  );
}
