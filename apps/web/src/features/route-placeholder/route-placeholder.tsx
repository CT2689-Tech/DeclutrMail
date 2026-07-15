'use client';

/**
 * `RoutePlaceholder` — calm "coming soon" surface for routes the
 * sidebar advertises but where the feature has not been built yet.
 *
 * Why this exists. The sidebar (packages/shared/src/shell/sidebar.tsx)
 * lists 11 nav items because the V2 plan has 11 launch surfaces.
 * Several of those routes (Brief, Snoozed, Screener, Quiet hours,
 * Activity, Billing, Settings root) are still queued for build. Until
 * each lands, clicking the nav item would 404 — which silently breaks
 * trust on the first session a user spends in the app, especially
 * with two accounts now connected and exploration high.
 *
 * Microcopy contract (D209, D212).
 *
 *   - Never apologetic. We don't say "we're sorry" or "not ready
 *     yet" — those frames cast the product as broken. Instead we
 *     name the next step ("Planned for V2.X") and route the user to
 *     the surface that does work today.
 *   - Never the forbidden empty-state placeholders ("Nothing here",
 *     "0 results", "Error"). The `EmptyState` primitive enforces the
 *     visual contract; this wrapper supplies the route-specific copy.
 *   - The "Screener" feature noun is allowed (D227 — it is the product
 *     name, not the banned verb).
 *
 * Visual contract. We compose the promoted `EmptyState` primitive
 * (D212) so every placeholder shares the same dashed-soft surface,
 * spacing, and icon disc the rest of the app uses for empty states.
 * That keeps these stubs visually consistent with the (already-shipped)
 * Triage / Followups empty states and makes a future swap to the real
 * screen mechanical — the page shell does not move when the feature
 * lands.
 *
 * `decisions` remains internal trace metadata for route call sites. Plan
 * identifiers are never rendered to users.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { EmptyState, tokens } from '@declutrmail/shared';

const { color, font, radius, text } = tokens;

export interface RoutePlaceholderCta {
  /** Internal route or external URL. */
  href: string;
  /** Visible label — sentence case, no trailing punctuation. */
  label: string;
  /** Optional render-as-link variant; default is the primary CTA. */
  tone?: 'primary' | 'default';
}

export interface RoutePlaceholderProps {
  /** Eyebrow chip — e.g. "Planned for V2.1". */
  status: string;
  /** Short headline. Sentence case, no trailing period. */
  title: string;
  /** One-paragraph body. Calm, never apologetic. */
  description: ReactNode;
  /** Plan D-numbers this stub will eventually fulfil. */
  decisions: readonly string[];
  /** Primary CTA — typically routes back to an active surface. */
  primaryCta: RoutePlaceholderCta;
  /** Optional secondary CTA. */
  secondaryCta?: RoutePlaceholderCta;
}

/**
 * The icon is shared across every placeholder so they read as the same
 * surface visually — a small "construction" glyph stroked at the same
 * weight as the rest of the sidebar icons (24×24, stroke 2).
 */
function PlaceholderIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function PlaceholderCtaLink({ cta }: { cta: RoutePlaceholderCta }) {
  // We can't pass an `href` straight into `<Button />` — Button renders
  // a `<button>`. The CTA needs to be a real `<Link>` so Next.js owns
  // client-side routing. To stay token-identical we wrap the link in
  // Button via `asChild`-less composition: render a Button-shaped
  // anchor inline using the same tokens the primitive uses.
  const isPrimary = (cta.tone ?? 'primary') === 'primary';
  return (
    <Link
      href={cta.href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 32,
        padding: '0 14px',
        background: isPrimary ? color.primary : color.card,
        color: isPrimary ? '#FFFFFF' : color.fg,
        border: `1px solid ${isPrimary ? color.primary : color.border}`,
        borderRadius: radius.sm,
        fontFamily: font.sans,
        fontSize: 13,
        fontWeight: 600,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {cta.label}
    </Link>
  );
}

export function RoutePlaceholder({
  status,
  title,
  description,
  primaryCta,
  secondaryCta,
}: RoutePlaceholderProps) {
  return (
    <section
      // `AppShell` already owns the outer `<main>` landmark. We render
      // a `<section>` so we don't nest two `main` elements (a11y). The
      // heading inside `EmptyState` (an `<h3>`) is discoverable to AT
      // via its `role=heading`; no `aria-labelledby` is needed since
      // `EmptyState` does not expose an id on its title node.
      style={{
        padding: '32px 24px',
        maxWidth: 720,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <span
        // Eyebrow status chip — mirrors the not-found page's "404"
        // chip so an unbuilt route reads as a peer of the 404 surface
        // visually, not as a broken page.
        style={{
          alignSelf: 'center',
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
        {status}
      </span>

      <EmptyState
        icon={<PlaceholderIcon />}
        title={title}
        description={description}
        action={
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            <PlaceholderCtaLink cta={primaryCta} />
            {secondaryCta != null && (
              <PlaceholderCtaLink cta={{ ...secondaryCta, tone: secondaryCta.tone ?? 'default' }} />
            )}
          </div>
        }
      />
    </section>
  );
}
