// 404 page (D167).
//
// Calm-branded, never apologetic — matches the D209 microcopy hard
// rule and the D2 cool/Vercel palette via shared tokens (Inter /
// JetBrains Mono / Fraunces are wired at the root layout — see
// layout.tsx). No new colours or fonts are introduced here; everything
// reads off `@declutrmail/shared`'s token surface.
//
// The page does NOT auto-fire a Sentry event — a 404 is an expected
// outcome (link rot, typed URLs) and would otherwise spam the
// dashboard. The 500 boundary (`error.tsx`) is where Sentry capture
// belongs (D167 + D170).
//
// Routing back is audience-aware (D140). A SIGNED-IN visitor is offered
// the app destinations — /triage (the daily ritual) + /senders (the
// directory). An ANONYMOUS visitor is offered marketing destinations —
// / (home) + /pricing — because /triage would only bounce them through
// a sign-in redirect. Audience is read from the session cookie's
// presence (see SESSION_COOKIE below).

import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { tokens } from '@declutrmail/shared';

const { color, font, text } = tokens;

// Session cookie set by the API on sign-in (HttpOnly JWT). Its mere
// PRESENCE is enough to route the 404 CTAs — an expired-but-present
// cookie still means "returning user", so "Back to Triage" (which
// refreshes or redirects to sign-in) is the right destination; a truly
// anonymous visitor has no cookie and gets the marketing CTAs instead.
// We never decode it here — presence, not validity, drives copy.
const SESSION_COOKIE = 'dm_access';

export const metadata: Metadata = {
  title: 'Page not found — DeclutrMail',
  description: 'The link may be stale, or the page may have moved. Your mailbox is untouched.',
  // Belt-and-braces: 404s already return HTTP 404, but an explicit
  // noindex keeps soft-404 URL variants out of the index too.
  robots: { index: false },
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
        color: isPrimary ? color.fgInverse : color.fg,
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

/**
 * The 404 page. Async server component: reads the session cookie to
 * decide which destinations to offer, then hands a plain boolean to the
 * presentational {@link NotFoundView} (so tests/stories render the view
 * synchronously without a request context). Reading `cookies()` opts
 * the page out of static prerendering — correct for a 404, which is
 * request-scoped by nature.
 */
export default async function NotFound() {
  const authed = (await cookies()).has(SESSION_COOKIE);
  return <NotFoundView authed={authed} />;
}

/**
 * Presentational 404. `authed` picks the destinations: a signed-in user
 * is routed back into the app (Triage / Senders); an anonymous visitor
 * gets marketing destinations (Home / Pricing) — sending them to /triage
 * would just bounce through a sign-in redirect. Exported for unit tests
 * + Storybook, which drive `authed` explicitly.
 */
export function NotFoundView({ authed }: { authed: boolean }) {
  const body = authed
    ? 'The link may be stale, or the page may have moved. Your mailbox and decisions are untouched.'
    : 'The link may be stale, or the page may have moved.';
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
          {body}
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
          {authed ? (
            <>
              <CtaLink href="/triage" tone="primary">
                Back to Triage
              </CtaLink>
              <CtaLink href="/senders" tone="default">
                Open Senders
              </CtaLink>
            </>
          ) : (
            <>
              <CtaLink href="/" tone="primary">
                Back to home
              </CtaLink>
              <CtaLink href="/pricing" tone="default">
                See pricing
              </CtaLink>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
