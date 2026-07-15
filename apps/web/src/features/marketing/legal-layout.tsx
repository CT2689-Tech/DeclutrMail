// Legal page shell for the public `(marketing)` route group (D146).
//
// Shared chrome for /privacy, /terms and /refunds: header wordmark,
// mono "Legal" label, display-font title, last-updated stamp, a
// table of contents built from the page's sections, and a footer that
// cross-links the three legal documents.
//
// Server component on purpose — legal pages are static prose with
// zero client JS (no hooks, no analytics bootstrap; PostHog consent
// is D147's banner, a separate unit). Rendering server-side also
// guarantees nothing here can reach AuthProvider (D134 invariant:
// public routes make NO auth round-trip).
//
// Typography: legal prose is hundreds of paragraphs, so per-element
// inline styles would drown the content. A scoped `<style>` block
// under `.dm-legal` styles the semantic tags (p, ul, table, a)
// instead — same pattern as the `<style>` keyframe registration in
// features/sync/sync-now-button.tsx, values read off shared tokens.

import type { ReactNode } from 'react';
import { tokens } from '@declutrmail/shared';

const { color, font, text } = tokens;

/** One row in the page's table of contents; `id` is the section anchor. */
export interface LegalTocItem {
  id: string;
  label: string;
}

/**
 * Prose typography, scoped under `.dm-legal` so the rules cannot leak
 * into app surfaces. Values mirror the shared token scale.
 */
const LEGAL_PROSE_CSS = `
.dm-legal p { margin: 0 0 14px; font-size: ${text.md}px; line-height: 1.7; color: ${color.fgSoft}; }
.dm-legal strong { color: ${color.fg}; font-weight: 600; }
.dm-legal ul, .dm-legal ol { margin: 0 0 14px; padding-left: 22px; }
.dm-legal li { font-size: ${text.md}px; line-height: 1.7; color: ${color.fgSoft}; margin-bottom: 6px; }
.dm-legal a { color: ${color.primary}; text-decoration: underline; text-underline-offset: 2px; }
.dm-legal table { width: 100%; border-collapse: collapse; margin: 0 0 14px; }
.dm-legal th { text-align: left; font-size: ${text.xs}px; font-family: ${font.mono}; text-transform: uppercase; letter-spacing: 0.08em; color: ${color.fgMuted}; padding: 8px 12px 8px 0; border-bottom: 1px solid ${color.border}; }
.dm-legal td { font-size: ${text.base}px; line-height: 1.6; color: ${color.fgSoft}; padding: 8px 12px 8px 0; border-bottom: 1px solid ${color.lineSoft}; vertical-align: top; }
.dm-legal code { font-family: ${font.mono}; font-size: 0.92em; background: ${color.paper}; border: 1px solid ${color.lineSoft}; border-radius: 4px; padding: 1px 5px; }
`;

/**
 * An anchored section: mono-numbered heading + prose body. Pages list
 * the same `id`/`title` pairs in their `toc` prop so the table of
 * contents and the anchors can never drift apart by accident.
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
    <section id={id} style={{ marginBottom: 36, scrollMarginTop: 88 }}>
      <h2
        style={{
          fontFamily: font.display,
          fontSize: text.xl,
          fontWeight: 600,
          letterSpacing: '-0.012em',
          color: color.fg,
          margin: '0 0 12px',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export function LegalPageLayout({
  title,
  label = 'Legal',
  lastUpdated,
  toc,
  children,
}: {
  title: string;
  /** Mono pill above the title — 'Legal' for the legal documents; the
   * support pages (/help, /contact, /security) pass their own. */
  label?: string;
  /** ISO date (YYYY-MM-DD) the document was last materially changed. */
  lastUpdated: string;
  toc: readonly LegalTocItem[];
  children: ReactNode;
}) {
  return (
    <div
      className="dm-legal"
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '32px 24px 64px',
      }}
    >
      <style>{LEGAL_PROSE_CSS}</style>

      <span
        style={{
          fontFamily: font.mono,
          fontSize: text.xs,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: color.primary,
          background: color.primarySoft,
          border: `1px solid ${color.primaryBorder}`,
          borderRadius: 9999,
          padding: '4px 10px',
        }}
      >
        {label}
      </span>

      <h1
        style={{
          fontFamily: font.display,
          fontSize: text['3xl'],
          fontWeight: 600,
          letterSpacing: '-0.018em',
          color: color.fg,
          margin: '16px 0 8px',
        }}
      >
        {title}
      </h1>

      <p
        style={{
          fontFamily: font.mono,
          fontSize: text.sm,
          color: color.fgMuted,
          margin: '0 0 28px',
        }}
      >
        Last updated: {lastUpdated}
      </p>

      <nav
        aria-label="On this page"
        style={{
          background: color.paper,
          border: `1px solid ${color.lineSoft}`,
          borderRadius: 10,
          padding: '16px 20px',
          marginBottom: 36,
        }}
      >
        <p
          style={{
            fontFamily: font.mono,
            fontSize: text.xs,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: color.fgMuted,
            margin: '0 0 10px',
          }}
        >
          On this page
        </p>
        <ol
          style={{
            margin: 0,
            paddingLeft: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {toc.map(({ id, label }) => (
            <li key={id} style={{ fontSize: text.base, lineHeight: 1.6 }}>
              <a href={`#${id}`} style={{ color: color.fgSoft, textDecoration: 'none' }}>
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <article>{children}</article>
    </div>
  );
}
