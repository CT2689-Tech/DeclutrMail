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
// (D227). Token-only styling; the headline carries the beta state, and
// the CTAs are the public site's capsules.

import type { Metadata } from 'next';
import { OAUTH_SCOPE_DISCLOSURE, tokens } from '@declutrmail/shared';
import { BETA_DENIED_REASON, BETA_DENIED_REASON_PARAM } from '@declutrmail/shared/contracts';

import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { oauthStartUrl } from '@/features/marketing/landing/urls';
import { BetaDeniedTracker } from './beta-denied-tracker';

const { color, font, radius, shadow } = tokens;

// Open beta is the live signup funnel, so /beta is indexable — routed
// through marketingPageMetadata for the same canonical + OG/Twitter block
// every marketing page carries. The `?reason=not_invited` variant is the
// same URL, so the canonical `/beta` collapses it (no duplicate).
export const metadata: Metadata = marketingPageMetadata({
  title: 'Open beta — DeclutrMail',
  description:
    'DeclutrMail is in open beta. Sign in with Google and start your first Gmail cleanup — no invite needed.',
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
        minHeight: 46,
        padding: '0 24px',
        background: isPrimary ? color.fg : color.fill,
        // fgInverse, not a literal: fg is ink on light and paper on dark,
        // so the readable lettering flips with it.
        color: isPrimary ? color.fgInverse : color.fg,
        border: 'none',
        borderRadius: radius.pill,
        boxShadow: isPrimary ? shadow.button : 'none',
        fontFamily: font.sans,
        fontSize: 15,
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
        minHeight: 'calc(100vh - 160px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '104px 16px',
      }}
    >
      <PageViewTracker page="beta" />
      {denied ? <BetaDeniedTracker /> : null}
      <div
        style={{
          maxWidth: 600,
          width: '100%',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <h1
          style={{
            fontFamily: font.display,
            fontSize: 'clamp(36px, 6vw, 52px)',
            lineHeight: 1.06,
            fontWeight: 600,
            letterSpacing: '-0.028em',
            textWrap: 'balance',
            margin: 0,
          }}
        >
          {denied ? 'This email needs an invite right now.' : 'DeclutrMail is in open beta.'}
        </h1>
        <p
          style={{
            fontSize: 18,
            color: color.fgSoft,
            lineHeight: 1.6,
            margin: 0,
            maxWidth: '56ch',
          }}
        >
          {denied
            ? 'Your Google sign-in worked, but this email isn’t on the invite list yet. No account was created. Write to us and we’ll sort out your invite.'
            : 'Anyone can sign in with Google and start reviewing senders — no invite or waitlist. It’s still a beta: expect the occasional rough edge. Manual email-moving actions show a preview and Activity undo; delivered unsubscribe requests are one-way.'}
        </p>

        <div
          style={{
            display: 'flex',
            gap: 12,
            marginTop: 12,
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

        {denied ? null : (
          <p
            style={{
              fontFamily: font.sans,
              fontSize: 13.5,
              lineHeight: 1.6,
              color: color.fgMuted,
              margin: '8px 0 0',
              maxWidth: '60ch',
            }}
          >
            {OAUTH_SCOPE_DISCLOSURE}
          </p>
        )}
      </div>
    </div>
  );
}
