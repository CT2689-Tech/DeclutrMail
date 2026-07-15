'use client';

import { useState } from 'react';
import { Button, Eyebrow, PrivacyBadge, tokens } from '@declutrmail/shared';
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
 * Privacy (D7 / D228): the shared `PrivacyBadge` ("Full bodies
 * fetched: 0" + the explicit storage list) is the load-bearing trust
 * artifact. The gate shows only stage labels + a percentage; it never
 * renders message-derived data.
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

/**
 * Escape-hatch wiring for a SECONDARY-mailbox sync (D116). The route
 * passes this only when there's another active mailbox to return to;
 * the first-run gate omits it, preserving the strict single-mailbox
 * gate (D6).
 */
export interface SyncGateEscape {
  /** Email of the mailbox to hop back to (the previously-active one). */
  returnToEmail: string;
  /** Switch the active mailbox back to it and leave the gate. */
  onReturn: () => void;
  /** True while the switch is in flight — disables the button. */
  returning?: boolean;
}

/**
 * The gate's eyebrow line. The D106 step machine makes the gate step 3
 * of FIVE for the first-run flow; a secondary-mailbox connect (D116)
 * is not part of that flow, so its route passes plain "One-time scan".
 */
const DEFAULT_EYEBROW = 'Step 3 of 5 · One-time scan';

export function SyncGate({
  status,
  escape,
  eyebrow = DEFAULT_EYEBROW,
}: {
  status: SyncStatus;
  escape?: SyncGateEscape | undefined;
  eyebrow?: string;
}) {
  if (status.readiness_status === 'failed') {
    return <SyncFailed status={status} escape={escape} />;
  }
  return <SyncProgress status={status} escape={escape} eyebrow={eyebrow} />;
}

function SyncProgress({
  status,
  escape,
  eyebrow,
}: {
  status: SyncStatus;
  escape?: SyncGateEscape | undefined;
  eyebrow: string;
}) {
  const active = activeStageIndex(status);
  const pct = Math.min(100, Math.max(0, status.progress_pct));

  return (
    <Shell>
      <Eyebrow>{eyebrow}</Eyebrow>
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

      <PrivacyBadge style={PRIVACY_BADGE_STYLE} />
      {escape && <SyncEscapeHatch escape={escape} />}
    </Shell>
  );
}

/**
 * "Stay here" keeps waiting on the gate; "Go back" switches the active
 * mailbox to the primary and leaves — the secondary keeps syncing in
 * the background, and the account-switcher badge + ready-toast (D116)
 * announce completion, so the in-background promise is honest.
 */
function SyncEscapeHatch({ escape }: { escape: SyncGateEscape }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div
      role="region"
      aria-label="Keep waiting or return to your other inbox"
      style={{
        marginTop: 26,
        maxWidth: 460,
        width: '100%',
        padding: '14px 16px',
        border: `1px solid ${color.border}`,
        borderRadius: 12,
        background: color.card,
      }}
    >
      <p style={{ margin: '0 0 12px', fontSize: 13, color: color.fgMuted, lineHeight: 1.5 }}>
        We’ll keep syncing this inbox in the background and let you know when it’s ready.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button tone="primary" onClick={() => setDismissed(true)}>
          Stay here
        </Button>
        <Button tone="ghost" onClick={escape.onReturn} disabled={escape.returning ?? false}>
          {escape.returning ? 'Switching…' : `Go back to ${escape.returnToEmail}`}
        </Button>
      </div>
    </div>
  );
}

function SyncFailed({
  status,
  escape,
}: {
  status: SyncStatus;
  escape?: SyncGateEscape | undefined;
}) {
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
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button tone="primary" onClick={() => window.location.reload()}>
          Try again
        </Button>
        {/* Don't strand a secondary connect on a failed gate — let them
            hop back to their (working) primary mailbox (D116). */}
        {escape && (
          <Button tone="ghost" onClick={escape.onReturn} disabled={escape.returning ?? false}>
            {escape.returning ? 'Switching…' : `Go back to ${escape.returnToEmail}`}
          </Button>
        )}
      </div>
      <PrivacyBadge style={PRIVACY_BADGE_STYLE} />
    </Shell>
  );
}

/**
 * Gate placement for the shared trust card (D228): full-width within the
 * 460px shell column, left-aligned (the Shell centers text for the
 * heading/stages — the badge's lists read as lists, not centered copy).
 */
const PRIVACY_BADGE_STYLE: React.CSSProperties = {
  marginTop: 26,
  width: '100%',
  textAlign: 'left',
};

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
