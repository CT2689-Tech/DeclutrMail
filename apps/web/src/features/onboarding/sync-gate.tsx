'use client';

import { useEffect, useState } from 'react';
import { Button, Eyebrow, tokens } from '@declutrmail/shared';
import type { SyncStatus, SyncStage } from '@declutrmail/shared/contracts';

const { color, font } = tokens;

/**
 * Onboarding sync gate (D109, D224).
 *
 * "Reading your inbox…" — the strict gate (D6) shown after a Gmail
 * connect, before the app opens. The progress bar + stage indicator
 * are driven by REAL backend state (`progress_pct`, `current_stage`)
 * — no fake ticking (D109 hard rule).
 *
 * This file is the PRESENTATIONAL view: it takes a `SyncStatus` and
 * renders. Polling + the ready→advance redirect live in the route
 * (`app/onboarding/page.tsx`) so Storybook can drive every state
 * (queued / syncing / ready / failed) without a network.
 *
 * Privacy (D7 / D228): the "🔒 Bodies read: 0 — forever" badge is the
 * load-bearing trust artifact. The gate shows only stage labels + a
 * percentage; it never renders message-derived data.
 */

/** The six user-facing stages (D109), in order. */
const UI_STAGES = [
  'Reading sender info',
  'Grouping by sender',
  'Calculating email patterns',
  'Detecting spikes & cadence',
  'Preparing recommendations',
  'Done — your inbox is ready',
] as const;

/**
 * Resolve which of the six UI stages is "active" right now.
 *
 * The backend has fewer, coarser DB stages than the six aspirational
 * UI labels, so the active row is derived from REAL `progress_pct`
 * (0–100 → one of six buckets) rather than a 1:1 stage map — this
 * keeps the animation honest (it only moves when the worker reports
 * progress) while still lighting all six rows over a sync's lifetime.
 * A `ready` readiness pins every row complete regardless of the
 * percentage the worker last wrote.
 */
function activeStageIndex(status: SyncStatus): number {
  if (status.readiness_status === 'ready') return UI_STAGES.length;
  const bucket = Math.floor((status.progress_pct / 100) * UI_STAGES.length);
  // Clamp into [0, len-1] while syncing so we never highlight "Done".
  return Math.min(UI_STAGES.length - 1, Math.max(0, bucket));
}

/** Friendly copy for the known terminal error codes. */
const ERROR_COPY: Record<string, string> = {
  GMAIL_QUOTA_EXCEEDED:
    'Gmail is rate-limiting the scan. We’ll retry automatically — check back shortly.',
};

export function SyncGate({ status }: { status: SyncStatus }) {
  if (status.readiness_status === 'failed') {
    return <SyncFailed status={status} />;
  }
  return <SyncProgress status={status} />;
}

function SyncProgress({ status }: { status: SyncStatus }) {
  const active = activeStageIndex(status);
  const pct = Math.min(100, Math.max(0, status.progress_pct));

  return (
    <Shell>
      <Eyebrow>Step 3 of 3 · One-time scan</Eyebrow>
      <h1
        style={{
          fontFamily: font.display,
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          margin: '6px 0 4px',
        }}
      >
        Reading your inbox…
      </h1>
      <p style={{ color: color.fgMuted, fontSize: 14, margin: '0 0 22px', maxWidth: 460 }}>
        This is a one-time scan. You can close this tab — we’ll email you when your inbox is ready.
      </p>

      {/* Progress bar — width is the real progress_pct. */}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Inbox scan progress"
        style={{
          height: 8,
          width: '100%',
          maxWidth: 460,
          background: color.lineSoft,
          borderRadius: 9999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: color.primary,
            borderRadius: 9999,
            transition: 'width 400ms ease',
          }}
        />
      </div>

      {/* Six-stage indicator. */}
      <ol
        style={{
          listStyle: 'none',
          padding: 0,
          margin: '22px 0 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          maxWidth: 460,
        }}
      >
        {UI_STAGES.map((label, i) => {
          const state = i < active ? 'done' : i === active ? 'active' : 'pending';
          return (
            <li
              key={label}
              aria-current={state === 'active' ? 'step' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                color:
                  state === 'pending'
                    ? color.fgMuted
                    : state === 'active'
                      ? color.fg
                      : color.fgSoft,
                fontWeight: state === 'active' ? 600 : 400,
              }}
            >
              <StageDot state={state} />
              {label}
            </li>
          );
        })}
      </ol>

      <TrustBadge />
      <PushPermissionAsk />
    </Shell>
  );
}

function SyncFailed({ status }: { status: SyncStatus }) {
  const copy =
    (status.error_code && ERROR_COPY[status.error_code]) ??
    'Something interrupted the scan. We’ll retry automatically — check back shortly.';
  return (
    <Shell>
      <Eyebrow tone="amber">Scan interrupted</Eyebrow>
      <h1
        style={{
          fontFamily: font.display,
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          margin: '6px 0 4px',
        }}
      >
        We hit a snag reading your inbox.
      </h1>
      <p style={{ color: color.fgMuted, fontSize: 14, margin: '0 0 20px', maxWidth: 460 }}>
        {copy}
      </p>
      <Button tone="primary" onClick={() => window.location.reload()}>
        Try again
      </Button>
      <TrustBadge />
    </Shell>
  );
}

function StageDot({ state }: { state: 'done' | 'active' | 'pending' }) {
  if (state === 'done') {
    return (
      <span
        aria-hidden
        style={{
          width: 16,
          height: 16,
          borderRadius: 9999,
          background: color.primary,
          color: '#fff',
          display: 'inline-grid',
          placeItems: 'center',
          fontSize: 10,
          flexShrink: 0,
        }}
      >
        ✓
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: 16,
        height: 16,
        borderRadius: 9999,
        border: `2px solid ${state === 'active' ? color.primary : color.border}`,
        background: state === 'active' ? color.primarySoft : 'transparent',
        flexShrink: 0,
        // A gentle pulse on the active dot signals live work.
        animation: state === 'active' ? 'dm-pulse 1.4s ease-in-out infinite' : undefined,
      }}
    />
  );
}

function TrustBadge() {
  return (
    <div
      style={{
        marginTop: 26,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderRadius: 9999,
        background: color.primaryWash,
        color: color.primaryDeep,
        fontFamily: font.mono,
        fontSize: 11,
        letterSpacing: '0.04em',
      }}
    >
      🔒 Bodies read: 0 — forever
    </div>
  );
}

/**
 * Subtle browser-push opt-in (D109). Renders only when the Notification
 * API exists and permission is still `default`. Clicking requests
 * permission; we don't register a push subscription here (that lands
 * with the notification-delivery feature) — this just captures consent
 * so the later "we'll email/notify you when ready" promise can be kept.
 */
function PushPermissionAsk() {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setSupported(true);
      setPermission(Notification.permission);
    }
  }, []);

  if (!supported || permission !== 'default') return null;

  return (
    <button
      type="button"
      onClick={() => {
        void Notification.requestPermission().then(setPermission);
      }}
      style={{
        marginTop: 14,
        background: 'transparent',
        border: `1px solid ${color.border}`,
        borderRadius: 9999,
        padding: '6px 14px',
        fontFamily: font.sans,
        fontSize: 13,
        color: color.fg,
        cursor: 'pointer',
      }}
    >
      🔔 Get notified when ready
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '32px 24px',
        background: color.bg,
        fontFamily: font.sans,
      }}
    >
      <style>{'@keyframes dm-pulse{0%,100%{opacity:1}50%{opacity:0.4}}'}</style>
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {children}
      </div>
    </main>
  );
}

export { activeStageIndex, UI_STAGES };
export type { SyncStage };
