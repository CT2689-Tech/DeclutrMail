'use client';

/**
 * Shared per-route error boundary body (D167 + D170 + D211).
 *
 * The 2026-07-04 launch audit found 9 app routes with NO error.tsx —
 * a render throw on /triage or /settings fell through to the global
 * boundary, replacing the whole shell. Each uncovered route now mounts
 * a thin error.tsx that renders this screen with its own Sentry
 * boundary tag; the pre-existing per-route boundaries (senders,
 * activity, autopilot, brief, …) keep their bespoke files.
 *
 * Privacy (D7): `error.message` is NEVER rendered — only the stable
 * `error.digest`.
 */

import Link from 'next/link';
import { useEffect } from 'react';
import { tokens } from '@declutrmail/shared';
import { initSentryBrowser } from '@/lib/sentry';
import { captureErrorBoundaryException, type ErrorBoundary } from '@/lib/error-capture';

const { color, font, text } = tokens;

export function RouteErrorScreen({
  error,
  reset,
  boundary,
  eyebrow,
  headline,
  body,
  escape,
}: {
  error: Error & { digest?: string | undefined };
  reset: () => void;
  /** Sentry boundary tag — closed union, matches the route segment. */
  boundary: ErrorBoundary;
  /** Short amber pill copy, e.g. "Settings hit a snag". */
  eyebrow: string;
  /** e.g. "We couldn't load your settings." */
  headline: string;
  /** One reassuring sentence — what is safe + what to do next. */
  body: string;
  /** Escape-hatch link — a route that is NOT this one. */
  escape: { href: string; label: string };
}) {
  useEffect(() => {
    void (async () => {
      await initSentryBrowser();
      await captureErrorBoundaryException(error, {
        boundary,
        digest: error.digest,
      });
    })();
  }, [error, boundary]);

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
          {eyebrow}
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
          {headline}
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

        {error.digest != null && (
          <code
            style={{
              fontFamily: font.mono,
              fontSize: text.xs,
              color: color.fgMuted,
              background: color.mutedBg,
              padding: '4px 8px',
              borderRadius: 6,
            }}
          >
            Reference: {error.digest}
          </code>
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
            href={escape.href}
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
            {escape.label}
          </Link>
        </div>
      </div>
    </main>
  );
}
