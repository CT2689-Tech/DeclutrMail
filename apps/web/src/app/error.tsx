// App Router error boundary (D167 + D170).
//
// Wraps the authed app shell. When a server component throws, or a
// client subtree errors during render, Next.js mounts this component
// with the captured `error` and a `reset()` callback that re-attempts
// render once the upstream is fixed.
//
// What this does:
//
//   1. Auto-fires `Sentry.captureException(error)` on mount via the
//      shared browser bootstrap (`lib/sentry.ts`). The bootstrap is
//      idempotent — re-mounting the boundary will not re-init Sentry.
//      Capture is gated on `NEXT_PUBLIC_SENTRY_DSN` being set, so
//      local dev stays quiet.
//
//   2. Renders calm, branded copy matching D209 microcopy rules. No
//      "Error" / "Oops" / "Something went wrong" placeholders.
//
//   3. Exposes a "Try again" CTA wired to Next's `reset()` prop. A
//      secondary "Back to Triage" link gives the user a way out if
//      the retry would loop.
//
// What this does NOT do:
//
//   - It does not store the error message in the rendered HTML. The
//     `error.digest` (a stable hash Next produces) is surfaced
//     instead, because the message can contain user data and would
//     leak through SSR.

'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { TechnicalDetails, tokens } from '@declutrmail/shared';
import { initSentryBrowser } from '@/lib/sentry';
import { captureErrorBoundaryException } from '@/lib/error-capture';

const { color, font, text } = tokens;

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined };
  reset: () => void;
}) {
  useEffect(() => {
    // Bootstrap Sentry (no-op if already initialised or DSN missing),
    // then capture this error. `captureErrorBoundaryException`
    // dynamically imports `@sentry/nextjs` so the boundary doesn't
    // pull the SDK into the main bundle unless an error actually
    // happens.
    void (async () => {
      await initSentryBrowser();
      await captureErrorBoundaryException(error, {
        boundary: 'app-router-error',
        digest: error.digest,
      });
    })();
  }, [error]);

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
          // Amber pill — softer than red, signals "attention" not
          // "alarm". Distinct from the empty-state primitive's teal
          // disc so a glance at the page reads as a transient
          // condition, not the normal empty surface.
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
          Something interrupted
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
          We&rsquo;ll pick up where you left off.
        </h1>
        <p
          style={{
            fontSize: text.md,
            color: color.fgSoft,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          Your mailbox and decisions are untouched. Try again, or head back to Triage and
          we&rsquo;ll retry the rest in the background.
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
            href="/triage"
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
            Back to Triage
          </Link>
        </div>
      </div>
    </main>
  );
}
