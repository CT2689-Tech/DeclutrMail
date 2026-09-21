import type { ReactNode } from 'react';

import { ScopeDisclosure } from '@/features/marketing/landing/scope-disclosure';
import { TrackedCta } from '@/features/marketing/landing/tracked-cta';
import { oauthStartUrl } from '@/features/marketing/landing/urls';
import { OnThisPage, RAIL_MIN_SECTIONS, type OnThisPageItem } from './on-this-page';
import './reading.css';

/**
 * The reading template every public content page shares: how-to, answers,
 * blog, FAQ, changelog, and — through `LegalPageLayout` — help, contact
 * and the legal documents. Server component; the only client code on
 * these routes is whatever island a page adds itself.
 */
export function ReadingLayout({
  title,
  lede,
  meta,
  toc,
  tocNarrow = 'list',
  centred = false,
  children,
}: {
  title: string;
  lede?: ReactNode;
  meta?: ReactNode;
  /** Section anchors; the rail appears only past `RAIL_MIN_SECTIONS`. */
  toc?: readonly OnThisPageItem[];
  tocNarrow?: 'list' | 'hidden';
  centred?: boolean;
  children: ReactNode;
}) {
  const hasToc = Boolean(toc && toc.length >= RAIL_MIN_SECTIONS);
  const className = ['dm-read', hasToc ? 'dm-read--rail' : '', centred ? 'dm-read--centred' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className}>
      <header className="dm-read-head">
        <h1 className="dm-read-title">{title}</h1>
        {lede ? <p className="dm-read-lede">{lede}</p> : null}
        {meta ? <p className="dm-read-meta">{meta}</p> : null}
      </header>
      {hasToc && toc ? <OnThisPage items={toc} narrow={tocNarrow} /> : null}
      <div className="dm-read-body">{children}</div>
    </div>
  );
}

/**
 * The quiet end-of-article invitation. "Start free" goes straight to
 * Google's consent screen, so the pre-consent scope disclosure sits
 * beside it, collapsed (copy contract in packages/shared/src/copy/privacy.ts).
 * The sentence is the homepage hero's own, not new copy.
 */
export function ReadingCta() {
  return (
    <aside className="dm-read-cta" aria-label="Try DeclutrMail">
      <p>Review your Gmail by sender. Preview which emails will move, then decide what stays.</p>
      <div className="dm-read-cta-actions">
        <TrackedCta
          className="dm-read-button"
          href={oauthStartUrl()}
          cta="connect_gmail"
          placement="final"
        >
          Start free
        </TrackedCta>
        <TrackedCta
          className="dm-read-quiet-link"
          href="/inbox-simulator"
          cta="try_demo"
          placement="final"
        >
          Try the demo
        </TrackedCta>
      </div>
      <ScopeDisclosure />
    </aside>
  );
}

/** Formats an ISO `YYYY-MM-DD` date for display without a timezone shift. */
export function formatReadingDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
