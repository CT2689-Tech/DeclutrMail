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

import { ReadingLayout } from '@/features/marketing/learn/learn-shell';
import type { Metadata } from 'next';
import { OAUTH_SCOPE_DISCLOSURE, tokens } from '@declutrmail/shared';
import { BETA_DENIED_REASON, BETA_DENIED_REASON_PARAM } from '@declutrmail/shared/contracts';

import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { permissionEntryUrl } from '@/features/marketing/landing/urls';
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

// Plain anchors keep permission entry and founder contact available
// without client-side navigation or an authenticated session.
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
        borderRadius: radius.md,
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
    <ReadingLayout
      centred
      title={denied ? 'This email needs an invite right now.' : 'DeclutrMail is in open beta.'}
      lede={
        denied
          ? 'Your Google sign-in worked, but this email is not on the invite list yet. No account was created.'
          : 'Start reviewing senders without an invite or waitlist. It is still a beta: expect the occasional rough edge.'
      }
    >
      <PageViewTracker page="beta" />
      {denied ? <BetaDeniedTracker /> : null}
      <p>
        {denied
          ? 'Write to us and we will help with your invite.'
          : 'Manual email-moving actions show a preview and Activity Undo. Delivered unsubscribe requests are one-way. Gmail stays the place where you read and reply.'}
      </p>
      <div className="dm-read-cta-actions">
        {!denied && (
          <CtaLink href={permissionEntryUrl()} tone="primary">
            Review Gmail permissions
          </CtaLink>
        )}
        <CtaLink href={FOUNDER_MAILTO} tone={denied ? 'primary' : 'default'}>
          Email the founder
        </CtaLink>
      </div>
      {!denied && (
        <>
          <p>
            <a href="/inbox-simulator">Try the daily review demo</a> before connecting.
          </p>
          <details>
            <summary>What Google will ask you to allow</summary>
            <p>{OAUTH_SCOPE_DISCLOSURE}</p>
          </details>
        </>
      )}
    </ReadingLayout>
  );
}
