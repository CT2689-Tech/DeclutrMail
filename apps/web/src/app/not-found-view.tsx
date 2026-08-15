// Presentational 404 (D167, D140 audience branch).
//
// Split out of `not-found.tsx` so BOTH the static page shell and the
// client island that resolves the audience can import it without either
// one dragging the other into the wrong bundle. Purely presentational:
// no data reads, no session knowledge — `authed` arrives as a prop, and
// tests/Storybook drive it directly.

import Link from 'next/link';
import { tokens } from '@declutrmail/shared';

const { color, font, text } = tokens;

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
 * Presentational 404. `authed` picks the destinations: a signed-in user
 * is routed back into the app (Triage / Senders); an anonymous visitor
 * gets marketing destinations (Home / Pricing) — sending them to /triage
 * would just bounce through a sign-in redirect. Exported for unit tests
 * + Storybook, which drive `authed` explicitly.
 */
export function NotFoundView({ authed }: { authed: boolean }) {
  const body = authed
    ? 'That link may be out of date, or the page may have moved. Your mailbox and decisions are untouched.'
    : 'That link may be out of date, or the page may have moved.';
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
