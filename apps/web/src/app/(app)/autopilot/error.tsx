// Per-feature error boundary for `/autopilot` — D38 + FOUNDER-FOLLOWUPS
// 2026-06-06. Scopes a render throw to this route; tag `autopilot`
// groups in Sentry distinctly. Privacy (D7): `error.message` never
// rendered.

'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { tokens } from '@declutrmail/shared';
import { initSentryBrowser } from '@/lib/sentry';
import { captureErrorBoundaryException } from '@/lib/error-capture';

const { color, font, text } = tokens;

export default function AutopilotError({
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
        boundary: 'autopilot',
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
          Autopilot hit a snag
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
          We couldn&rsquo;t load your rules.
        </h1>
        <p
          style={{
            fontSize: text.md,
            color: color.fgSoft,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          Your rules and suggestions are untouched — nothing has paused or changed. Try again, or
          head to Triage.
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
              color: '#FFFFFF',
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
