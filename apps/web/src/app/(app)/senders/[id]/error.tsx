// Per-feature error boundary for `/senders/[id]` — sender-detail route
// (D38 session-3; D167 + D170 + D211).
//
// Why scoped per-route. Without this file the segment falls through to
// `app/error.tsx`, which takes over the whole authed shell — topbar,
// nav, sender list all vanish behind a single full-page error card.
// Co-locating the boundary keeps the rest of the chrome usable when a
// single sender's data fetch / render throws, and lets the "Back to
// Senders" CTA dump the user onto a screen they recognise instead of
// `/triage`.
//
// What this does:
//
//   1. Bootstraps Sentry (no-op without `NEXT_PUBLIC_SENTRY_DSN`) and
//      captures the error with a `surface=senders` + boundary tag so
//      it groups distinctly from the global boundary's hits.
//
//   2. Renders calm copy (D209 microcopy: no "Oops", no "Something
//      went wrong"). The amber accent matches `app/error.tsx`.
//
//   3. Exposes "Try again" (Next's `reset()`) and "Back to Senders"
//      so a render loop has a way out.
//
// Privacy (D7): the `error.message` is NEVER rendered. Only the stable
// `error.digest` Next produces is surfaced, since the raw message can
// carry user data (sender id, email substrings) and would leak via SSR.

'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { TechnicalDetails, tokens } from '@declutrmail/shared';
import { initSentryBrowser } from '@/lib/sentry';
import { captureErrorBoundaryException } from '@/lib/error-capture';

const { color, font, text } = tokens;

export default function SenderDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined };
  reset: () => void;
}) {
  useEffect(() => {
    void (async () => {
      await initSentryBrowser();
      await captureErrorBoundaryException(error, {
        boundary: 'senders-detail',
        digest: error.digest,
      });
    })();
  }, [error]);

  return (
    <main
      style={{
        minHeight: '60vh',
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
          style={{
            fontFamily: font.mono,
            fontSize: text.xs,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: color.amber,
            background: color.amberBg,
            border: `1px solid ${color.amber}`,
            borderRadius: 9999,
            padding: '4px 10px',
          }}
        >
          This sender hit a snag
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
          We couldn&rsquo;t load this sender.
        </h1>
        <p
          style={{
            fontSize: text.md,
            color: color.fgSoft,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          Your mailbox and decisions are untouched. Try again, or head back to Senders — the rest of
          the app is still good.
        </p>

        {error.digest != null && (
          <TechnicalDetails summary="Show support reference">
            <code style={{ fontFamily: font.mono, fontSize: text.xs }}>
              Reference: {error.digest}
            </code>
          </TechnicalDetails>
        )}

        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 6,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <button
            type="button"
            onClick={() => reset()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 32,
              padding: '0 14px',
              background: color.primary,
              color: color.fgInverse,
              border: `1px solid ${color.primary}`,
              borderRadius: 7,
              fontFamily: font.sans,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Try again
          </button>
          <Link
            href="/senders"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 32,
              padding: '0 14px',
              background: color.card,
              color: color.fg,
              border: `1px solid ${color.line}`,
              borderRadius: 7,
              fontFamily: font.sans,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Back to Senders
          </Link>
        </div>
      </div>
    </main>
  );
}
