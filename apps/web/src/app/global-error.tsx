// Global error boundary (D167).
//
// This is the outermost App Router error surface. Next.js mounts it
// when the root layout itself throws — at that point the regular
// `error.tsx` boundary is unavailable because the layout it sits
// inside never rendered. The component MUST therefore include its
// own `<html>` and `<body>` tags (Next.js requirement) and avoid
// depending on any chrome from `app/layout.tsx` (fonts, providers,
// etc.).
//
// Because we don't have access to the font CSS vars wired in the
// root layout (the layout is the thing that crashed), we fall back
// to a system font stack. Colour tokens are still safe to use —
// they're literal hex/rgba values in `@declutrmail/shared`, no
// runtime context required.
//
// Sentry: same wrapper as `error.tsx`, with a `boundary:
// app-router-global-error` tag so the dashboard distinguishes
// "layout crashed" from "page crashed".

'use client';

import { useEffect } from 'react';
import { tokens } from '@declutrmail/shared';
import { initSentryBrowser } from '@/lib/sentry';
import { captureErrorBoundaryException } from '@/lib/error-capture';

const { color, text } = tokens;

// System font stack — usable without the root layout's font vars,
// matching the calm-neutral tone we'd otherwise get from Geist.
const SYSTEM_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

export default function GlobalError({
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
        boundary: 'app-router-global-error',
        digest: error.digest,
      });
    })();
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: color.bg,
          color: color.fg,
          fontFamily: SYSTEM_SANS,
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
              fontFamily: SYSTEM_MONO,
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
              fontSize: text['3xl'],
              fontWeight: 600,
              letterSpacing: '-0.018em',
              margin: 0,
            }}
          >
            DeclutrMail is reloading.
          </h1>
          <p
            style={{
              fontSize: text.md,
              color: color.fgSoft,
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            Your mailbox and decisions are untouched. Reload the page to continue — we&rsquo;ll pick
            up where you left off.
          </p>

          {error.digest != null && (
            <code
              style={{
                fontFamily: SYSTEM_MONO,
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
              fontFamily: SYSTEM_SANS,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              marginTop: 6,
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
