'use client';

import { useState } from 'react';
import { Button, Eyebrow, PrivacyBadge, tokens } from '@declutrmail/shared';
import type { SyncStatus, SyncStage } from '@declutrmail/shared/contracts';

import { useRetryInitialSync } from '@/features/sync/api/use-retry-initial-sync';
import { useLogout } from '@/features/auth/api/use-logout';
import { useDisconnectMailbox } from '@/features/mailboxes/api/use-disconnect-mailbox';

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
 * Privacy (D7 / D228): the shared `PrivacyBadge` ("We never fetch or
 * store full email contents" + the generated storage list) is the
 * load-bearing trust artifact. The gate shows only stage labels + a
 * percentage; it never renders message-derived data.
 *
 * The counter phrasing this comment used to quote ("Full bodies
 * fetched: 0") is BANNED by CLAUDE.md §2.1 and is asserted absent by
 * this file's own tests — it was stale text one copy-paste away from
 * becoming real copy.
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
  // A non-finite percentage must not defeat the clamps below: every
  // comparison against NaN is false, so `Math.min/max` propagate it
  // unchanged and NO row would light up — the frozen-gate shape.
  const pct = Number.isFinite(status.progress_pct) ? status.progress_pct : 0;
  const bucket = Math.floor((pct / 100) * UI_STAGES.length);
  // Clamp to len-2, NOT len-1. len-1 IS "Done — your inbox is ready", so
  // the old bound did precisely what its comment said it prevented: the
  // worker writes `computing_recommendations, 90` and then
  // `finalizing, 97` while still `syncing`, and for that whole span —
  // the score cascade over every sender, minutes on a large mailbox —
  // the gate rendered "Done — your inbox is ready" in bold with
  // aria-current="step", under a heading still reading "Reading your
  // inbox…", while the app stayed gated (audit 2026-08-21).
  //
  // "Done" is now reachable ONLY from `readiness_status === 'ready'`
  // above, which is the one signal that means it.
  return Math.min(UI_STAGES.length - 2, Math.max(0, bucket));
}

/**
 * Friendly copy for the known terminal error codes.
 *
 * These describe a TERMINAL state — the worker has spent its attempts
 * and nothing re-queues the mailbox on its own. The old copy promised
 * "we'll retry automatically", which was simply untrue and left users
 * waiting for a retry that never came (first-run flow audit,
 * 2026-07-28). Every string here now points at the button instead.
 */
const ERROR_COPY: Record<string, string> = {
  RateLimitError:
    'Gmail was rate-limiting the scan, so we stopped. Waiting a minute before trying again usually clears it.',
  AuthExpiredError:
    'Google stopped accepting our access partway through. Reconnecting the account restores it.',
  InvalidGrantError:
    'Google revoked our access to this inbox, so the scan could not finish. Reconnect the account to grant it again.',
  TransientError:
    'The scan kept losing its connection to Gmail and ran out of attempts. Starting it again usually works.',
  PermanentError:
    'Gmail refused part of the scan, so it stopped. Trying again is safe — if it stops here twice, contact support and we will finish it manually.',
  ValidationError:
    'The scan stopped on something we could not process. Trying again is safe; if it stops here twice, contact support.',
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
  mailboxId,
}: {
  status: SyncStatus;
  escape?: SyncGateEscape | undefined;
  eyebrow?: string;
  /**
   * The mailbox this gate is DISPLAYING. BOTH gates pass it — including
   * first-run, where "the active mailbox" is resolved from a cached
   * `me` on the client but from live session state on the server, so
   * the two can disagree. Naming it makes the retry act on the mailbox
   * actually on screen. Absent (stories only) the retry is disabled
   * rather than aimed at whatever happens to be active.
   */
  mailboxId?: string | null | undefined;
}) {
  if (status.readiness_status === 'failed') {
    return <SyncFailed status={status} escape={escape} mailboxId={mailboxId} />;
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
  mailboxId,
}: {
  status: SyncStatus;
  escape?: SyncGateEscape | undefined;
  mailboxId?: string | null | undefined;
}) {
  const retry = useRetryInitialSync(mailboxId);
  const logout = useLogout();
  const disconnect = useDisconnectMailbox();
  // No id, no retry — an unscoped request would re-queue whatever the
  // server considers active, which is exactly the mailbox this screen
  // cannot vouch for.
  const canRetry = mailboxId != null && mailboxId !== '';
  const copy =
    (status.error_code && ERROR_COPY[status.error_code]) ??
    'Something interrupted the scan and it stopped. Your Gmail is untouched — starting it again is safe.';
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
        {/* A REAL retry: re-queues the failed sync server-side. This
            was `window.location.reload()`, which re-rendered the same
            dead screen — the reconciler sweeps `queued` rows only, so
            nothing re-queued a `failed` one. */}
        <Button
          tone="primary"
          onClick={() => canRetry && retry.mutate()}
          disabled={!canRetry || retry.isPending}
        >
          {retry.isPending ? 'Starting…' : 'Try again'}
        </Button>
        {/* Don't strand a secondary connect on a failed gate — let them
            hop back to their (working) primary mailbox (D116). */}
        {escape && (
          <Button tone="ghost" onClick={escape.onReturn} disabled={escape.returning ?? false}>
            {escape.returning ? 'Switching…' : `Go back to ${escape.returnToEmail}`}
          </Button>
        )}
        {/* FIRST-RUN trap exits (D158 triage, founder-approved): with no
            secondary mailbox to hop to, a user whose retry also fails
            was walled in — the onboarding guard bounces every route back
            here. Two real ways out, neither optimistic:
            - Disconnect returns the onboarding machine to the connect
              step (mailboxes drop to zero), so they can re-grant OAuth
              or walk away. Uses the row-scoped id; disabled without one.
            - Sign out ends the session outright. */}
        {!escape && (
          <>
            <Button
              tone="ghost"
              onClick={() => mailboxId && disconnect.mutate(mailboxId)}
              disabled={!mailboxId || disconnect.isPending}
            >
              {disconnect.isPending ? 'Disconnecting…' : 'Disconnect and start over'}
            </Button>
            <Button tone="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
              {logout.isPending ? 'Signing out…' : 'Sign out'}
            </Button>
          </>
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
