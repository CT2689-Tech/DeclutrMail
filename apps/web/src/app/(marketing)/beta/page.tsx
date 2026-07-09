// /beta — beta status page (buildout F7; open-beta copy 2026-07-07).
//
// Public marketing route: renders WITHOUT AuthProvider (the
// `(marketing)` group), so a denied signup landing here never blocks
// on `GET /api/auth/me`. Two ways in:
//
//   1. The API's OAuth callback 302s here with `?reason=not_invited`
//      when the beta gate denies a brand-new signup (the redirect
//      contract lives in `@declutrmail/shared/contracts` beta-gate.ts).
//      That variant mounts `BetaDeniedTracker` → `beta_gate_denied`.
//      It can only fire while BETA_GATE_ENABLED=true — the gate is OFF
//      in production (open signup), so the organic variant is the one
//      visitors see and its copy says so honestly.
//   2. Organic navigation — same page, no event.
//
// Copy is calm and never apologetic (D209) and uses no banned verbs
// (D227). Visual language mirrors `not-found.tsx`: token-only styling,
// soft-teal label disc, the same CTA-link shape.

import type { Metadata } from 'next';
import { tokens } from '@declutrmail/shared';
import { BETA_DENIED_REASON, BETA_DENIED_REASON_PARAM } from '@declutrmail/shared/contracts';

import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { oauthStartUrl } from '@/features/marketing/landing/urls';
import { BetaDeniedTracker } from './beta-denied-tracker';

const { color, font, text } = tokens;

// Open beta is the live signup funnel, so /beta is indexable — routed
// through marketingPageMetadata for the same canonical + OG/Twitter block
// every marketing page carries. The `?reason=not_invited` variant is the
// same URL, so the canonical `/beta` collapses it (no duplicate).
export const metadata: Metadata = marketingPageMetadata({
  title: 'Open beta — DeclutrMail',
  description:
    'DeclutrMail is in open beta. Sign in with Google and start cleaning up your inbox — no invite needed.',
  path: '/beta',
});

// support@ is the address the legal pages already publish (D146);
// the mailbox itself is a tracked FOUNDER-FOLLOWUPS launch item. Was
// the founder's personal Gmail — a leak on a public marketing page
// (2026-07-04 launch audit).
const FOUNDER_MAILTO = 'mailto:support@declutrmail.com?subject=DeclutrMail%20beta';

// Plain <a>, same shape as not-found.tsx's CTA. Not next/link on
// purpose: the primary href is the API's OAuth start endpoint (a
// cross-origin hop Link would try to prefetch) and the secondary is a
// mailto — neither benefits from client-side routing.
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
    <a
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
    </a>
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
          {denied ? 'Private beta' : 'Open beta'}
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
          {denied ? 'This email needs an invite right now.' : 'DeclutrMail is in open beta.'}
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
            ? 'Your Google sign-in worked, but this email isn’t on the invite list yet. No account was created. Write to us and we’ll sort out your invite.'
            : 'Anyone can sign in with Google and start cleaning up — no invite or waitlist. It’s still a beta: expect the occasional rough edge, and every action stays previewed and reversible.'}
        </p>

        {!denied ? (
          <p
            style={{
              fontSize: text.sm,
              color: color.fgMuted,
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            <a
              href="/help#beta-limits"
              style={{ color: color.fgMuted, textDecoration: 'underline', textUnderlineOffset: 3 }}
            >
              What to expect during beta →
            </a>
          </p>
        ) : null}

        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 6,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {denied ? (
            <CtaLink href={FOUNDER_MAILTO} tone="primary">
              Email the founder
            </CtaLink>
          ) : (
            <>
              <CtaLink href={oauthStartUrl()} tone="primary">
                Sign in with Google
              </CtaLink>
              <CtaLink href={FOUNDER_MAILTO} tone="default">
                Email the founder
              </CtaLink>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
