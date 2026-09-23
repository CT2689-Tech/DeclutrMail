import type { ReactNode } from 'react';

import { OAUTH_SCOPE_DISCLOSURE } from '@declutrmail/shared';

import { TrackedCta } from '@/features/marketing/landing/tracked-cta';
import { permissionEntryUrl } from '@/features/marketing/landing/urls';

/**
 * Two public templates live here, both on the `--dm-*` tokens:
 *
 * - `ProductStoryShell` + `StorySection` — the narrative /how-it-works
 *   page: a hero with a raised product visual, then flat sections.
 * - `DocPage` + `DocSection` — the reading-column template for
 *   /methodology and /security: a 680px column, and a sticky
 *   "On this page" list on wide screens.
 *
 * Site navigation and the footer come from the marketing route-group
 * layout; nothing here renders a header or footer of its own.
 */

/**
 * The Google-permission disclosure that sits beside every CTA that starts
 * OAuth. Collapsed by default; the locked copy renders verbatim inside,
 * and the summary makes no claim of its own.
 */
export function ScopeNote() {
  return (
    <details className="dm-story-scope">
      <summary>What Google will ask you to allow</summary>
      <p>{OAUTH_SCOPE_DISCLOSURE}</p>
    </details>
  );
}

export function ProductStoryShell({
  title,
  lede,
  visual,
  children,
}: {
  title: string;
  lede: string;
  visual: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="dm-story">
      <article>
        <header className="dm-story-hero dm-story-shell">
          <div className="dm-story-hero-copy">
            <h1>{title}</h1>
            <p className="dm-story-hero-lede">{lede}</p>
            <div className="dm-story-actions">
              <TrackedCta
                className="dm-story-button dm-story-button-primary"
                href={permissionEntryUrl()}
                cta="connect_gmail"
                placement="hero"
              >
                Start free
              </TrackedCta>
              <TrackedCta
                className="dm-story-link"
                href="/inbox-simulator"
                cta="try_demo"
                placement="hero"
              >
                Try the demo
              </TrackedCta>
            </div>
            <ScopeNote />
          </div>
          <div className="dm-story-hero-visual">{visual}</div>
        </header>

        {children}
      </article>
    </div>
  );
}

export function StorySection({
  id,
  title,
  intro,
  children,
  aside,
  layout = 'stack',
}: {
  id: string;
  title: string;
  intro?: ReactNode;
  /** Extra content kept with the heading (beside the body on wide screens). */
  aside?: ReactNode;
  children?: ReactNode;
  /** `side` puts the heading beside the content on wide screens. */
  layout?: 'stack' | 'side';
}) {
  return (
    <section
      id={id}
      className={`dm-story-section dm-story-shell dm-story-section-${layout}`}
      aria-labelledby={`${id}-title`}
    >
      <div className="dm-story-section-head">
        <h2 id={`${id}-title`}>{title}</h2>
        {intro ? <div className="dm-story-intro">{intro}</div> : null}
        {aside}
      </div>
      {children ? <div className="dm-story-section-body">{children}</div> : null}
    </section>
  );
}

export function FinalStoryCta({ title, body }: { title: string; body: string }) {
  return (
    <section className="dm-story-final" aria-labelledby="dm-story-final-title">
      <h2 id="dm-story-final-title">{title}</h2>
      <p>{body}</p>
      <div className="dm-story-actions">
        <TrackedCta
          className="dm-story-button dm-story-button-primary"
          href={permissionEntryUrl()}
          cta="connect_gmail"
          placement="final"
        >
          Start free
        </TrackedCta>
        <TrackedCta className="dm-story-link" href="/pricing" cta="see_pricing" placement="final">
          Compare plans
        </TrackedCta>
      </div>
      <ScopeNote />
    </section>
  );
}

/** One row in a document page's "On this page" list; `id` is the section anchor. */
export interface DocTocItem {
  readonly id: string;
  readonly label: string;
}

export interface DocHighlight {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export function DocPage({
  title,
  lede,
  lastUpdated,
  toc,
  highlights,
  children,
  after,
}: {
  title: string;
  lede?: string;
  /** ISO date (YYYY-MM-DD) the page was last materially changed. */
  lastUpdated?: string;
  toc: readonly DocTocItem[];
  highlights?: readonly DocHighlight[];
  children: ReactNode;
  /** Full-width content after the reading column, e.g. a closing CTA. */
  after?: ReactNode;
}) {
  return (
    <div className="dm-story dm-doc">
      <div className="dm-doc-layout">
        <nav className="dm-doc-toc" aria-label="On this page">
          <p>On this page</p>
          <ol>
            {toc.map(({ id, label }) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="dm-doc-column">
          <header className="dm-doc-header">
            <h1>{title}</h1>
            {lede ? <p className="dm-doc-lede">{lede}</p> : null}
            {lastUpdated ? <p className="dm-doc-updated">Last updated: {lastUpdated}</p> : null}
          </header>
          {highlights && (
            <nav className="dm-doc-highlights" aria-label="Page highlights">
              {highlights.map(({ id, label, detail }) => (
                <a className="dm-doc-highlight" key={id} href={`#${id}`}>
                  <strong>{label}</strong>
                  <span>{detail}</span>
                </a>
              ))}
            </nav>
          )}
          {children}
        </article>
      </div>
      {after}
    </div>
  );
}

export function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="dm-doc-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </section>
  );
}
