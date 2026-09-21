'use client';

import { Button, tokens } from '@declutrmail/shared';
import type { SyncStatus, SyncStage } from '@declutrmail/shared/contracts';

import { useRetryInitialSync } from '@/features/sync/api/use-retry-initial-sync';
import { useLogout } from '@/features/auth/api/use-logout';
import { useDisconnectMailbox } from '@/features/mailboxes/api/use-disconnect-mailbox';
import { startMailboxConnect } from '@/features/mailboxes/connect-mailbox-url';
import { AUTH_RECOVERY_ERROR_CODES } from '@/features/mailboxes/mailbox-health';

const { color, font, text, radius, motion } = tokens;

/**
 * Onboarding sync gate (D109, D224).
 *
 * "Reading your inbox…" — the strict gate (D6) shown after a Gmail
 * connect, before the app opens. ONE progress bar bound to the real
 * `progress_pct` and ONE sentence naming the real `current_stage` —
 * no fake ticking (D109 hard rule), no aspirational stage list.
 *
 * This file is the PRESENTATIONAL view: it takes a `SyncStatus` and
 * renders. Polling + the ready→advance redirect live in the route
 * (`app/onboarding/page.tsx`) so Storybook can drive every state
 * (queued / syncing / ready / failed) without a network.
 *
 * Privacy (D7 / D228): the gate shows a stage sentence + a percentage
 * and never renders message-derived data. The trust badge is NOT here:
 * a waiting screen is not a decision point — it renders on the promise
 * step, directly above the button that starts Google consent.
 */

/**
 * ONE sentence per REAL backend stage (D224). Typed against the
 * contract's stage union, so a new worker stage is a compile error here
 * until it has a sentence — the gate can never show a label for work
 * the worker is not doing.
 */
const STAGE_SENTENCE: Record<SyncStage, string> = {
  queued: 'Waiting to start.',
  fetching_metadata: 'Reading sender info.',
  building_sender_index: 'Grouping email by sender.',
  computing_recommendations: 'Preparing recommendations.',
  finalizing: 'Finishing up.',
  ready: 'Your inbox is ready.',
  failed: 'The scan stopped.',
};

/**
 * The sentence under the bar. "Your inbox is ready" is reachable ONLY
 * from `readiness_status === 'ready'` — the one signal that means it.
 * The worker writes late stages at 90–97% while the app is still gated
 * (the score cascade over every sender, minutes on a large mailbox), and
 * a stage/readiness disagreement must never read as done (audit
 * 2026-08-21).
 */
function stageSentence(status: SyncStatus): string {
  if (status.readiness_status === 'ready') return STAGE_SENTENCE.ready;
  if (status.current_stage === 'ready') return STAGE_SENTENCE.finalizing;
  return STAGE_SENTENCE[status.current_stage];
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
/**
 * Error codes whose `ERROR_COPY` above already diagnoses a revoked/
 * expired Gmail grant. QA-sync-20260831-07: the gate used to offer only
 * "Try again" for these — re-queuing a full scan against the SAME dead
 * token, which fails again at `getClient` and burns one of the retry
 * route's rate-limited attempts, with no reconnect action anywhere on
 * screen. Display-only: this does NOT touch `syncStatusNeedsReconnect`
 * or the backend's `INVALID_GRANT_ERROR`/`notNeedingReconnect` sweep
 * contract (packages/workers/src/mailbox-reconnect.ts), which govern
 * periodic-sweep eligibility and are a separate, wider change.
 *
 * Shared with `SyncNowButton`'s failed-indicator (Codex adversarial
 * review of this QA round) — both surfaces read the one set exported
 * from mailbox-health.ts so this classification can't drift between
 * them again.
 */

const ERROR_COPY: Record<string, string> = {
  RateLimitError: 'Gmail rate-limited the scan, so it stopped. Wait a minute, then try again.',
  AuthExpiredError:
    'Google stopped accepting our access partway through. Reconnecting the account restores it.',
  InvalidGrantError:
    'Google is not granting the access needed to scan this inbox. Reconnect the account and allow Gmail access.',
  TransientError: 'The scan kept losing its connection to Gmail and stopped. Try again.',
  PermanentError: 'Gmail refused part of the scan. Try again — if it fails twice, contact support.',
  ValidationError:
    'The scan stopped on something we could not process. Try again — if it fails twice, contact support.',
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

export function SyncGate({
  status,
  escape,
  mailboxId,
}: {
  status: SyncStatus;
  escape?: SyncGateEscape | undefined;
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
  return <SyncProgress status={status} escape={escape} />;
}

function SyncProgress({
  status,
  escape,
}: {
  status: SyncStatus;
  escape?: SyncGateEscape | undefined;
}) {
  // A non-finite percentage must not defeat the clamp: every comparison
  // against NaN is false, so Math.min/max would propagate it into the
  // width and aria-valuenow — the frozen-gate shape.
  const pct = Number.isFinite(status.progress_pct)
    ? Math.min(100, Math.max(0, status.progress_pct))
    : 0;

  return (
    <Shell>
      <h1 style={titleStyle}>Reading your inbox…</h1>

      {/* Progress bar — width is the real progress_pct. */}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Inbox scan progress"
        style={{
          height: 6,
          width: '100%',
          maxWidth: 360,
          marginTop: 28,
          background: color.fill,
          borderRadius: radius.pill,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: color.primary,
            borderRadius: radius.pill,
            transition: `width ${motion.base} ${motion.ease}`,
          }}
        />
      </div>

      {/* The real current_stage, as one sentence. */}
      <p
        role="status"
        data-testid="sync-stage"
        style={{
          color: color.fgMuted,
          fontSize: text.lg,
          lineHeight: 1.45,
          margin: '16px 0 0',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {stageSentence(status)}
      </p>

      {/* The secondary keeps syncing in the background after the hop; the
          account-switcher badge + ready-toast (D116) announce completion. */}
      {escape && (
        <div style={{ marginTop: 24 }}>
          <Button tone="ghost" onClick={escape.onReturn} disabled={escape.returning ?? false}>
            {escape.returning ? 'Switching…' : `Go back to ${escape.returnToEmail}`}
          </Button>
        </div>
      )}
    </Shell>
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
  const needsReconnect =
    status.error_code != null && AUTH_RECOVERY_ERROR_CODES.has(status.error_code);
  const copy =
    (status.error_code && ERROR_COPY[status.error_code]) ??
    'Something interrupted the scan. Your Gmail is untouched — try again.';
  return (
    <Shell>
      <h1 style={titleStyle}>The inbox scan stopped.</h1>
      <p
        style={{ color: color.fgMuted, fontSize: text.lg, lineHeight: 1.45, margin: '12px 0 28px' }}
      >
        {copy}
      </p>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {needsReconnect ? (
          // QA-sync-20260831-07: "Try again" here would re-queue a full
          // scan against the SAME revoked/expired token, fail again at
          // `getClient`, and burn a rate-limited retry attempt for
          // nothing — the copy above already tells the user the real
          // fix is reconnecting.
          <Button
            tone="primary"
            size="xl"
            onClick={() => canRetry && startMailboxConnect(mailboxId ?? undefined)}
            disabled={!canRetry}
            style={{ minWidth: 240 }}
          >
            Reconnect Gmail
          </Button>
        ) : (
          // A REAL retry: re-queues the failed sync server-side. This
          // was `window.location.reload()`, which re-rendered the same
          // dead screen — the reconciler sweeps `queued` rows only, so
          // nothing re-queued a `failed` one.
          <Button
            tone="primary"
            size="xl"
            onClick={() => canRetry && retry.mutate()}
            disabled={!canRetry || retry.isPending}
            style={{ minWidth: 240 }}
          >
            {retry.isPending ? 'Starting…' : 'Try again'}
          </Button>
        )}
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
          <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              tone="ghost"
              onClick={() => mailboxId && disconnect.mutate(mailboxId)}
              disabled={!mailboxId || disconnect.isPending}
            >
              {disconnect.isPending ? 'Disconnecting…' : 'Disconnect Gmail'}
            </Button>
            <Button tone="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
              {logout.isPending ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        )}
      </div>
    </Shell>
  );
}

const titleStyle = {
  fontFamily: font.sans,
  fontSize: text['3xl'],
  fontWeight: 650,
  letterSpacing: '-0.025em',
  lineHeight: 1.12,
  color: color.fg,
  margin: 0,
} as const;

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
        padding: '48px 24px',
        background: color.bg,
        fontFamily: font.sans,
      }}
    >
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

export { stageSentence };
