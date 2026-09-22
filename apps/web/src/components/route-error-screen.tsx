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
import styles from '@/app/(app)/route-loading.module.css';
import {
  editorialColumnStyle,
  editorialTitleStyle,
  EditorialKicker,
} from '@/features/editorial/page';
import { useEffect } from 'react';
import { Button, TechnicalDetails, tokens } from '@declutrmail/shared';
import { initSentryBrowser } from '@/lib/sentry';
import { captureErrorBoundaryException, type ErrorBoundary } from '@/lib/error-capture';

const { color, font, motion, radius, text } = tokens;

export function RouteErrorScreen({
  error,
  title,
  kicker,
  maxWidth,
  triageMode,
  gap = 24,
  reset,
  boundary,
  headline,
  body,
  escape,
}: {
  error: Error & { digest?: string | undefined };
  /** Route identity remains visible when its body fails. Omit for root errors. */
  title?: string;
  kicker?: string;
  maxWidth?: number;
  triageMode?: 'focus' | 'list';
  gap?: number;
  reset: () => void;
  /** Sentry boundary tag — closed union, matches the route segment. */
  boundary: ErrorBoundary;
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

  const ErrorHeading = title ? 'h2' : 'h1';

  // The shared ErrorState composition (amber disc, title, one muted
  // sentence, one capsule) — kept inline only so the headline stays this
  // error heading and the escape link + support reference can sit beneath.
  return (
    <main
      className={triageMode ? styles.triage : undefined}
      data-triage-mode={triageMode}
      style={{
        minHeight: '60vh',
        background: color.bg,
        color: color.fg,
        fontFamily: font.sans,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '56px 24px',
        ...(title
          ? {
              ...editorialColumnStyle,
              ...(maxWidth ? { maxWidth } : {}),
              minHeight: undefined,
              alignItems: 'stretch',
              justifyContent: 'flex-start',
              flexDirection: 'column',
              gap,
            }
          : {}),
      }}
    >
      {title && (
        <>
          {kicker && <EditorialKicker>{kicker}</EditorialKicker>}
          <h1 style={editorialTitleStyle}>{title}</h1>
        </>
      )}
      <style>{`.dm-route-escape { transition: background ${motion.fast} ${motion.ease}; }
.dm-route-escape:hover { background: ${color.fill}; }`}</style>
      <div
        style={{
          maxWidth: 480,
          ...(title ? { margin: '0 auto', padding: '24px 0' } : {}),
          width: '100%',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.pill,
            background: color.amberBg,
            color: color.amber,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: text['2xl'],
            fontWeight: 650,
            lineHeight: 1,
            marginBottom: 20,
          }}
        >
          !
        </span>
        <ErrorHeading
          style={{
            fontFamily: font.sans,
            fontSize: text['2xl'],
            fontWeight: 650,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          {headline}
        </ErrorHeading>
        <p
          style={{
            fontSize: text.md,
            color: color.fgMuted,
            lineHeight: 1.5,
            margin: '8px 0 0',
            maxWidth: 400,
          }}
        >
          {body}
        </p>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            marginTop: 24,
          }}
        >
          <Button tone="primary" size="lg" onClick={() => reset()} style={{ minWidth: 200 }}>
            Try again
          </Button>
          <Link
            href={escape.href}
            className="dm-route-escape"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 44,
              padding: '0 18px',
              borderRadius: radius.pill,
              color: color.fgSoft,
              fontFamily: font.sans,
              fontSize: text.md,
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {escape.label}
          </Link>
        </div>

        {error.digest != null && (
          <div style={{ marginTop: 16 }}>
            <TechnicalDetails summary="Show support reference">
              <span style={{ fontSize: text.xs, fontVariantNumeric: 'tabular-nums' }}>
                Reference: {error.digest}
              </span>
            </TechnicalDetails>
          </div>
        )}
      </div>
    </main>
  );
}
