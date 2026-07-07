// /beta — private-beta waitlist page (buildout F7).
//
// Public marketing route: renders WITHOUT AuthProvider (the
// `(marketing)` group), so a denied signup landing here never blocks
// on `GET /api/auth/me`. Two ways in:
//
//   1. The API's OAuth callback 302s here with `?reason=not_invited`
//      when the beta gate denies a brand-new signup (the redirect
//      contract lives in `@declutrmail/shared/contracts` beta-gate.ts).
//      That variant mounts `BetaDeniedTracker` → `beta_gate_denied`.
//   2. Organic navigation — same page, no event.
//
// Copy is calm and never apologetic (D209) and uses no banned verbs
// (D227). Visual language mirrors `not-found.tsx`: token-only styling,
// soft-teal label disc, the same CTA-link shape.

import Link from 'next/link';
import { tokens } from '@declutrmail/shared';
import { BETA_DENIED_REASON, BETA_DENIED_REASON_PARAM } from '@declutrmail/shared/contracts';

import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { BetaDeniedTracker } from './beta-denied-tracker';

const { color, font, text } = tokens;

export const metadata = {
  title: 'Private beta — DeclutrMail',
  description: 'DeclutrMail is in private beta. Join the waitlist to get your invite.',
};

// support@ is the address the legal pages already publish (D146);
// the mailbox itself is a tracked FOUNDER-FOLLOWUPS launch item. Was
// the founder's personal Gmail — a leak on a public marketing page
// (2026-07-04 launch audit).
const FOUNDER_MAILTO =
  'mailto:support@declutrmail.com?subject=DeclutrMail%20beta%20invite%20request';

// Same anchor-shaped CTA as not-found.tsx — Next's <Link> must own the
// element, so the Button primitive can't be reused directly.
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

export default async function BetaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const denied = params[BETA_DENIED_REASON_PARAM] === BETA_DENIED_REASON;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <PageViewTracker page="beta" />
      {denied ? <BetaDeniedTracker /> : null}
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
          Private beta
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
          DeclutrMail is invite-only right now.
        </h1>
        <p
          style={{
            fontSize: text.md,
            color: color.fgSoft,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {denied
            ? 'Your Google sign-in worked, but this email isn’t on the invite list yet. No account was created.'
            : 'We’re inviting people in gradually while we tune the experience.'}{' '}
          Join the waitlist and we&rsquo;ll email you when your spot opens — or write to the founder
          directly.
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
          <CtaLink href="/pricing" tone="primary">
            Join the waitlist
          </CtaLink>
          <CtaLink href={FOUNDER_MAILTO} tone="default">
            Email the founder
          </CtaLink>
        </div>
      </div>
    </div>
  );
}
