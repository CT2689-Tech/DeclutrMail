// Legal page shell for the public `(marketing)` route group (D146).
//
// Shared chrome for /privacy, /terms, /refunds and /cookies, and for the
// support pages (/help, /contact, /security): the public-content reading
// template (`learn/reading.css`) — display-font title, last-updated line,
// an "On this page" list built from the page's sections (a sticky left
// rail on wide screens for long documents), and the prose body.
//
// Server component on purpose — legal pages are static prose with
// zero client JS (no hooks, no analytics bootstrap; PostHog consent
// is D147's banner, a separate unit). Rendering server-side also
// guarantees nothing here can reach AuthProvider (D134 invariant:
// public routes make NO auth round-trip).

import type { ReactNode } from 'react';

import { ReadingLayout } from '@/features/marketing/learn/learn-shell';
import type { OnThisPageItem } from '@/features/marketing/learn/on-this-page';

/** One row in the page's table of contents; `id` is the section anchor. */
export type LegalTocItem = OnThisPageItem;

/**
 * An anchored section. Pages list the same `id`/`title` pairs in their
 * `toc` prop so the table of contents and the anchors can never drift
 * apart by accident. The scroll margin keeps a jumped-to heading clear
 * of the sticky public header.
 */
export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} style={{ scrollMarginTop: 88 }}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function LegalPageLayout({
  title,
  lastUpdated,
  toc,
  centred = false,
  children,
}: {
  title: string;
  /**
   * @deprecated No longer rendered — the reading template carries no
   * label above the title. Kept so existing callers still type-check.
   */
  label?: string;
  /** ISO date (YYYY-MM-DD) the document was last materially changed. */
  lastUpdated: string;
  toc: readonly LegalTocItem[];
  /** A short page (contact) set as one calm centred column. */
  centred?: boolean;
  children: ReactNode;
}) {
  return (
    <ReadingLayout
      title={title}
      meta={<span>Last updated: {lastUpdated}</span>}
      toc={toc}
      centred={centred}
    >
      <article>{children}</article>
    </ReadingLayout>
  );
}
