// 404 page (D167).
//
// Calm-branded, never apologetic — matches the D209 microcopy hard
// rule and the D2 cool/Vercel palette via shared tokens (D1: Geist
// Sans + JetBrains Mono are wired at the root layout). No new colours
// or fonts are introduced here; everything reads off
// `@declutrmail/shared`'s token surface.
//
// The page does NOT auto-fire a Sentry event — a 404 is an expected
// outcome (link rot, typed URLs) and would otherwise spam the
// dashboard. The 500 boundary (`error.tsx`) is where Sentry capture
// belongs (D167 + D170).
//
// Routing back: the canonical "home" for the authed app is /triage
// (the daily ritual surface); Senders is the secondary landing for
// users who prefer the directory view. We surface both so the user is
// not forced into a single path.

import Link from 'next/link';
import { tokens } from '@declutrmail/shared';

const { color, font, text } = tokens;

export const metadata = {
  title: 'Page not found — DeclutrMail',
};

// Anchor-shaped CTAs styled to read like our `<Button />` primitive —
// we can't use Button directly because Next's <Link> needs to own the
// rendered element for client-side routing, and Button's prop surface
// doesn't expose an `asChild` slot. Inline styles keep the two
// surfaces token-identical without rebuilding the primitive.
function CtaLink({
  href,
  tone,
  children,
}: {
  href: string;
  tone: 'primary' | 'default';
  children: React.ReactNode;
}) {
  const isPrimary = tone === 'primary';
  return (
    <Link
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 32,
        padding: '0 14px',
        background: isPrimary ? color.primary : color.card,
        color: isPrimary ? '#FFFFFF' : color.fg,
        border: `1px solid ${isPrimary ? color.primary : color.line}`,
        borderRadius: 7,
        fontFamily: font.sans,
        fontSize: 13,
        fontWeight: 600,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Link>
  );
}

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: color.bg,
        color: color.fg,
        fontFamily: font.sans,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: '100%',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <span
          // Soft-teal label disc — the calm visual signature shared
          // with the empty-state primitive (D212). Same hue, same
          // radius, intentionally non-alarming.
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
          404
        </span>
        <h1
          style={{
            fontFamily: font.display,
            fontSize: text['3xl'],
            fontWeight: 600,
            letterSpacing: '-0.018em',
            margin: 0,
          }}
        >
          We can&rsquo;t find that page.
        </h1>
        <p
          style={{
            fontSize: text.md,
            color: color.fgSoft,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          The link may be stale, or the page may have moved. Your mailbox and decisions are
          untouched.
        </p>

        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 6,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <CtaLink href="/triage" tone="primary">
            Back to Triage
          </CtaLink>
          <CtaLink href="/senders" tone="default">
            Open Senders
          </CtaLink>
        </div>
      </div>
    </main>
  );
}
