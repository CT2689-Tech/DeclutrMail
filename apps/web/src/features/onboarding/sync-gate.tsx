'use client';

import { editorialOnboardingActionStyle } from '@/features/editorial/page';
import { OnboardingPhase } from './onboarding-phase';

import { Button, tokens } from '@declutrmail/shared';
import {
  AUTH_RECOVERY_ERROR_CODES,
  type SyncMessageProgress,
  type SyncStatus,
  type SyncStage,
} from '@declutrmail/shared/contracts';

import { useRetryInitialSync } from '@/features/sync/api/use-retry-initial-sync';
import { useLogout } from '@/features/auth/api/use-logout';
import { useDisconnectMailbox } from '@/features/mailboxes/api/use-disconnect-mailbox';
import { startMailboxConnect } from '@/features/mailboxes/connect-mailbox-url';
import { useScanTimeLeft } from './scan-time-left';

const { color, font, text, radius, motion } = tokens;

/**
 * Onboarding sync gate (D109, D224).
 *
 * "Reading your Gmail…" — the strict gate (D6) shown after a Gmail
 * connect, before the app opens. D109's one line saying the user may
 * leave, ONE progress bar bound to the real `progress_pct` and ONE
 * line under it: while the scan reads the mailbox, the real counts
 * ("12,400 of 40,898 emails", plus time left from the worker's own
 * batches); otherwise a sentence naming the real
 * `current_stage` — no fake ticking (D109 hard rule), no aspirational
 * stage list.
 *
 * This file is the PRESENTATIONAL view: it takes a `SyncStatus` and
 * renders. Polling + the ready→advance redirect live in the route
 * (`app/onboarding/page.tsx`) so Storybook can drive every state
 * (queued / syncing / ready / failed) without a network.
 *
 * Privacy (D7 / D228): the gate shows a stage sentence, a percentage and
 * message counts — no message content. The trust badge is NOT here:
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
 * The worker writes late stages at 80–97% while the app is still gated —
 * seconds on a 101k-message mailbox (dev `sync_runs`, 2026-09; scoring is
 * queued, not run, in that stage) — and a stage/readiness disagreement
 * must never read as done (audit 2026-08-21).
 */
function stageSentence(status: SyncStatus): string {
  if (status.readiness_status === 'ready') return STAGE_SENTENCE.ready;
  if (status.current_stage === 'ready') return STAGE_SENTENCE.finalizing;
  return STAGE_SENTENCE[status.current_stage];
}

/**
 * The counts, only while the scan reads the mailbox — the one stage they
 * describe. `null` before the mailbox is listed; `undefined` when this
 * poll could not read them, or from an API that does not send the field
 * yet. Either way no line, never a guessed number — but a failed read
 * leaves the time left's pace alone.
 */
function readingCounts(status: SyncStatus): SyncMessageProgress | null | undefined {
  if (status.readiness_status !== 'syncing' || status.current_stage !== 'fetching_metadata') {
    return null;
  }
  return status.message_progress;
}

/** "about 10 min left" — minutes rounded up; past an hour, up to the next 5. */
function timeLeftPhrase(msLeft: number): string {
  const minutes = Math.max(1, Math.ceil(msLeft / 60_000));
  if (minutes < 60) return `about ${minutes} min left`;
  const rounded = Math.ceil(minutes / 5) * 5;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `about ${hours} hr left` : `about ${hours} hr ${rest} min left`;
}

/**
 * "12,400 of 40,898 emails" — or, before the first batch lands, what the
 * listing found: a zero that sits for a whole batch reads as stuck. The
 * no-break space keeps "40,898 emails" whole when the line wraps.
 */
function countText(counts: SyncMessageProgress): string {
  const total = `${counts.total.toLocaleString('en-US')}\u00A0${counts.total === 1 ? 'email' : 'emails'}`;
  return counts.processed === 0
    ? `Found ${total}`
    : `${counts.processed.toLocaleString('en-US')} of ${total}`;
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
 * For the codes in `AUTH_RECOVERY_ERROR_CODES` (`@declutrmail/shared/
 * contracts`), whose `ERROR_COPY` below diagnoses a revoked/expired Gmail
 * grant, the gate offers Reconnect instead of "Try again".
 * QA-sync-20260831-07: it used to offer only "Try again" — re-queuing a
 * full scan against the SAME dead token, which fails again at `getClient`
 * and burns one of the retry route's rate-limited attempts, with no
 * reconnect action anywhere on screen. Display-only: this does NOT touch
 * `syncStatusNeedsReconnect` or the backend's
 * `INVALID_GRANT_ERROR`/`notNeedingReconnect` sweep contract
 * (packages/workers/src/mailbox-reconnect.ts), which govern periodic-sweep
 * eligibility and are a separate, wider change.
 *
 * Shared with `SyncNowButton`'s failed-indicator (Codex adversarial
 * review of this QA round) — both surfaces read that one set so this
 * classification can't drift between them again.
 */

const ERROR_COPY: Record<string, string> = {
  RateLimitError: 'Gmail rate-limited the scan, so it stopped. Wait a minute, then try again.',
  AuthExpiredError:
    'Google stopped accepting our access. Reconnect Gmail and allow access on Google’s screen.',
  InvalidGrantError:
    'Google is not granting the access needed to scan this inbox. Reconnect the account and allow Gmail access.',
  TransientError: 'The scan kept losing its connection to Gmail and stopped. Try again.',
  // The address, not "contact support": on a first run the onboarding
  // guard bounces every in-app route back here, so Help is unreachable.
  PermanentError:
    'Gmail refused part of the scan. Try again — if it fails twice, email support@declutrmail.com.',
  ValidationError:
    'The scan stopped on something we could not process. Try again — if it fails twice, email support@declutrmail.com.',
};

/**
 * "Go back to <address>" can run past a phone-width card: Button is
 * nowrap at a fixed height, and an address has no spaces to break on.
 * Let this one label wrap, anywhere, at the default button's height.
 */
export const ESCAPE_BUTTON_STYLE = {
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  height: 'auto',
  minHeight: 36,
  paddingBlock: 8,
  maxWidth: '100%',
  textAlign: 'center',
} as const;

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
 * The D109 reassurance line: the scan runs without this tab, so the user
 * may leave. The email clause is stated only when the "Your inbox is
 * ready" email will actually go — `emailPrefs.syncComplete` is the
 * send-time switch (unsubscribing from all mail turns it off too), and
 * once #771 lands the email goes only for a mailbox's FIRST finished
 * scan (`firstReady` in `sync-ready-email.trigger.ts`). A re-scan of a
 * mailbox that finished before — a retry after a failed re-scan, a
 * reconnect — gets no promise: until #771 it still sends, so this line
 * under-promises, never over.
 * (D109's "This is a one-time scan." is gone: a reconnect or a retry
 * re-runs the scan, and nobody acts on the sentence.)
 */
function leaveSentence(readyEmail: boolean): string {
  return readyEmail
    ? 'You can close this tab — we’ll email you when your inbox is ready.'
    : 'You can close this tab and come back later.';
}

export function SyncGate({
  status,
  escape,
  mailboxId,
  readyEmail = false,
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
  /** True only when the sync-complete email is switched on for this user. */
  readyEmail?: boolean | undefined;
}) {
  if (status.readiness_status === 'failed') {
    return <SyncFailed status={status} escape={escape} mailboxId={mailboxId} />;
  }
  return <SyncProgress status={status} escape={escape} readyEmail={readyEmail} />;
}

function SyncProgress({
  status,
  escape,
  readyEmail,
}: {
  status: SyncStatus;
  escape?: SyncGateEscape | undefined;
  readyEmail: boolean;
}) {
  // A non-finite percentage must not defeat the clamp: every comparison
  // against NaN is false, so Math.min/max would propagate it into the
  // width and aria-valuenow — the frozen-gate shape.
  const pct = Number.isFinite(status.progress_pct)
    ? Math.min(100, Math.max(0, status.progress_pct))
    : 0;
  // `ready` renders only until the route navigates away (the secondary
  // gate's effect-driven replace). Say so plainly — no "Reading…" title
  // over a finished scan, and no "close this tab" once there is nothing
  // left to wait for.
  const ready = status.readiness_status === 'ready';
  // Strictly null: the API always sends the field, so a missing one is
  // unknown, and unknown promises nothing.
  const emailOnReady = readyEmail && status.last_synced_at === null;
  const counts = readingCounts(status);
  const msLeft = useScanTimeLeft(counts);

  return (
    <Shell>
      {/* "Gmail", not "inbox": the scan reads all mail but Spam and Trash,
          and the count below says how much. */}
      <h1 style={titleStyle}>{ready ? 'Your inbox is ready.' : 'Reading your Gmail…'}</h1>
      {!ready && (
        // Same sub-line treatment as StepShell on the sibling steps.
        <p
          data-testid="sync-leave"
          style={{
            color: color.fgMuted,
            fontSize: text.lg,
            lineHeight: 1.45,
            maxWidth: 460,
            margin: '14px 0 0',
          }}
        >
          {leaveSentence(emailOnReady)}
        </p>
      )}

      {/* Progress bar — width is the real progress_pct. */}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Scan progress"
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

      {/* The real current_stage, as one sentence. Ready says it in the title.
          While counts show, it stays the live status for screen readers
          only — a count that changes every batch would be announced each
          time. */}
      {!ready && (
        <p
          role="status"
          data-testid="sync-stage"
          style={counts ? SCREEN_READER_ONLY : UNDER_BAR_LINE}
        >
          {stageSentence(status)}
        </p>
      )}
      {counts && (
        <>
          <p data-testid="sync-count" style={UNDER_BAR_LINE}>
            {countText(counts)}
            {/* Neither the total nor the time splits across lines. */}
            {msLeft !== null && <span className="dm-scan-sep">{'\u00A0· '}</span>}
            <span className="dm-scan-time" style={{ whiteSpace: 'nowrap' }}>
              {msLeft !== null && timeLeftPhrase(msLeft)}
            </span>
          </p>
          <style>{SCAN_COUNT_CSS}</style>
        </>
      )}

      {/* The secondary keeps syncing in the background after the hop; the
          account-switcher badge + ready-toast (D116) announce completion. */}
      {escape && (
        <div style={{ marginTop: 24 }}>
          <Button
            tone="ghost"
            onClick={escape.onReturn}
            disabled={escape.returning ?? false}
            style={ESCAPE_BUTTON_STYLE}
          >
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
      <h1 style={titleStyle}>The scan stopped.</h1>
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
            style={editorialOnboardingActionStyle}
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
            style={editorialOnboardingActionStyle}
          >
            {retry.isPending ? 'Starting…' : 'Try again'}
          </Button>
        )}
        {/* Don't strand a secondary connect on a failed gate — let them
            hop back to their (working) primary mailbox (D116). */}
        {escape && (
          <Button
            tone="ghost"
            onClick={escape.onReturn}
            disabled={escape.returning ?? false}
            style={ESCAPE_BUTTON_STYLE}
          >
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

const UNDER_BAR_LINE = {
  color: color.fgMuted,
  fontSize: text.lg,
  lineHeight: 1.45,
  margin: '16px 0 0',
  fontVariantNumeric: 'tabular-nums',
} as const;

/**
 * The count and its time share one line where they fit. On a phone they
 * do not (~333px of text in a 222–332px card, measured 2026-09-26), and a
 * wrapped line strands the dot at its end: there the time takes a line of
 * its own, without the dot, held open while counts show so the centred
 * card does not jump each time a time comes or goes. From 540px up the
 * card holds even a seven-digit count with an hours estimate on one line.
 */
const SCAN_COUNT_CSS = `@media (max-width: 539px) {
  .dm-scan-sep { display: none; }
  .dm-scan-time { display: block; min-height: 1.45em; }
}`;

const SCREEN_READER_ONLY = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

const titleStyle = {
  fontFamily: font.display,
  fontSize: 'clamp(30px, 4vw, 42px)',
  fontWeight: 400,
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
          maxWidth: 540,
          padding: 'clamp(24px, 4vw, 40px)',
          background: color.card,
          border: `1px solid ${color.border}`,
          borderRadius: radius.lg,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <OnboardingPhase phase="scan" />
        {children}
      </div>
    </main>
  );
}

export { stageSentence, timeLeftPhrase };
