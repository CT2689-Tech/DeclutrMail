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
// to a system font stack. Colour variables have literal fallbacks
// because the root layout's token stylesheet may not have loaded.
//
// Sentry: same wrapper as `error.tsx`, with a `boundary:
// app-router-global-error` tag so the dashboard distinguishes
// "layout crashed" from "page crashed".

'use client';

import { useEffect } from 'react';
import { TechnicalDetails, tokens } from '@declutrmail/shared';
import { initSentryBrowser } from '@/lib/sentry';
import { captureErrorBoundaryException } from '@/lib/error-capture';

const { text } = tokens;
// Keep the initial root-layout failure readable without any loaded CSS.
// When the normal stylesheet exists, its active theme still takes precedence.
const color = {
  bg: 'var(--dm-bg, #f6f2eb)',
  fg: 'var(--dm-fg, #2d2630)',
  fgSoft: 'var(--dm-fg-soft, #625a63)',
  fgInverse: 'var(--dm-fg-inverse, #ffffff)',
  paper: 'var(--dm-paper, #efe8ed)',
  lineSoft: 'var(--dm-line-soft, rgba(45, 38, 48, 0.07))',
  primary: 'var(--dm-primary, #59415f)',
  amber: 'var(--dm-amber, #b45309)',
  amberDeep: 'var(--dm-amber-deep, #92400e)',
  amberBg: 'var(--dm-amber-bg, rgba(245, 158, 11, 0.1))',
} as const;

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
        <GlobalErrorContent error={error} reset={reset} />
      </body>
    </html>
  );
}

/** Pure fallback content also rendered by the isolated Storybook fixture. */
export function GlobalErrorContent({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined };
  reset: () => void;
}) {
  return (
    <main
      style={{
        color: color.fg,
        background: color.bg,
        fontFamily: SYSTEM_SANS,
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
          color: color.amberDeep,
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
        We couldn’t load DeclutrMail.
      </h1>
      <p
        style={{
          fontSize: text.md,
          color: color.fgSoft,
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        Try again to continue.
      </p>

      {error.digest != null && (
        <TechnicalDetails
          summary="Show support reference"
          style={{
            background: color.paper,
            color: color.fg,
            border: `1px solid ${color.lineSoft}`,
            fontFamily: SYSTEM_SANS,
          }}
        >
          <code style={{ fontFamily: SYSTEM_MONO, fontSize: text.xs }}>
            Reference: {error.digest}
          </code>
        </TechnicalDetails>
      )}

      <button
        type="button"
        onClick={() => reset()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 44,
          padding: '0 14px',
          background: color.primary,
          color: color.fgInverse,
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
        Try again
      </button>
    </main>
  );
}
