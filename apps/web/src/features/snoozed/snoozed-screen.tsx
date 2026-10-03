'use client';

import {
  editorialColumnStyle,
  editorialTitleStyle,
  EditorialKicker,
  EditorialDescription,
} from '@/features/editorial/page';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import {
  Button,
  EmptyState,
  ErrorState,
  ScreenIntro,
  tokens,
  useIsAtMost,
} from '@declutrmail/shared';
import type { EventPayloads } from '@declutrmail/shared/observability';

import { useOptionalAuth } from '@/features/auth/auth-provider';
import { useUserTimeZone } from '@/features/auth/api/use-me';
import { MailboxActionContext } from '@/features/auth/mailbox-action-context';
import { ApiError } from '@/lib/api/client';
import type { SnoozedSenderRow } from '@/lib/api/snoozed';
import { loadErrorDescription } from '@/lib/load-error-copy';
import { track } from '@/lib/posthog';
import { useNow } from '@/lib/use-now';

import { flatRowCss } from '@/features/settings/flat-list';
import { useSetSnooze, useSnoozed, useWakeNow } from './api/use-snoozed';
import {
  formatWakeTime,
  groupByWakeTime,
  snoozePresets,
  WAKE_BUCKET_LABELS,
  WAKE_BUCKETS,
  type WakeBucket,
} from './snooze-times';

const { color, font, radius, text } = tokens;

/** The D82 preset id recorded on `snooze_set` (D159). */
type SnoozePresetEventId = EventPayloads['snooze_set']['preset'];

/**
 * Later screen (D78–D80, D82, D245).
 *
 * Lists every sender with an active Later return time, grouped by
 * wake-time bucket per D80 (Later today / Tomorrow / This week /
 * Eventually). Every Later action requires that time (D245).
 *
 * Row actions (D80):
 *   - **Wake now** — preview-light inline confirm (the wake is
 *     RESTORATIVE: it re-adds INBOX and removes the Later label;
 *     nothing is archived, unsubscribed, or deleted — so the full
 *     D226 modal preview is not required; the confirm still states
 *     exactly what will happen before anything mutates). The restore
 *     runs in the snooze-wake worker; the row shows "Waking…" and the
 *     list polls until it drops off.
 *   - **Change return time** — D82 presets + custom date/time
 *     + optional note. Later cannot be made indefinite.
 *
 * Canonical product language (D245): "Later" is both the verb and the
 * feature/screen name. Internal snooze identifiers remain stable.
 *
 * Honesty notes (no fake data, CLAUDE.md §10): the count shown is the
 * REAL number of messages currently in the Later label (from the local
 * mirror); when the per-mailbox label mapping hasn't been published
 * yet the count renders as "count syncing…", never a guess. There is
 * no "intercepted so far" copy — arrival interception (D79
 * future-routing) has not shipped.
 *
 * Privacy (D7, D228): renders sender display metadata, counts, and
 * times only. No subjects, no snippets.
 */
// Fast polling is a bounded UI wait, not evidence that Gmail completed a return.
const WAKE_FAST_POLL_MS = 2 * 60 * 1_000;
type WakeRequest = {
  lastAttemptAt: string | null;
  timer: string;
  deadline: number;
  delayed: boolean;
};

export function SnoozedScreen({ initialNow }: { initialNow?: number } = {}) {
  const auth = useOptionalAuth();
  // Optimistic requests belong to one mailbox; switching accounts remounts them.
  return (
    <SnoozedScreenContents key={auth?.me.activeMailboxId ?? 'isolated'} initialNow={initialNow} />
  );
}

function SnoozedScreenContents({ initialNow }: { initialNow: number | undefined }) {
  const liveNow = useNow(60_000);
  const now = liveNow ?? initialNow ?? null;
  const [wakeRequests, setWakeRequests] = useState<ReadonlyMap<string, WakeRequest>>(new Map());
  const wakingIds = useMemo(
    () => new Set([...wakeRequests].filter(([, request]) => !request.delayed).map(([id]) => id)),
    [wakeRequests],
  );
  const query = useSnoozed({ refetchInterval: wakingIds.size > 0 ? 2_000 : 60_000 });

  useEffect(() => {
    void track('page_viewed', { page: 'snoozed', mailbox_id: null });
  }, []);

  const rows = useMemo(() => query.data ?? [], [query.data]);
  useEffect(() => {
    // An unavailable list is not a completed restore. Unchanged cached failures
    // immediately after enqueue are not the outcome of this new request either.
    if (!query.isSuccess || wakeRequests.size === 0) return;
    const byId = new Map(rows.map((row) => [row.senderId, row]));
    const still = new Map(
      [...wakeRequests].filter(([id, request]) => {
        const row = byId.get(id);
        if (!row || `${row.snoozedAt}/${row.snoozedUntil}` !== request.timer) return false;
        const newFailure =
          (row.returnStatus === 'retrying' || row.returnStatus === 'missed') &&
          row.lastReturnAttemptAt !== null &&
          (request.lastAttemptAt === null ||
            Date.parse(row.lastReturnAttemptAt) > Date.parse(request.lastAttemptAt));
        return !newFailure;
      }),
    );
    if (still.size !== wakeRequests.size) setWakeRequests(still);
  }, [rows, query.isSuccess, wakeRequests]);

  useEffect(() => {
    const active = [...wakeRequests.values()].filter((request) => !request.delayed);
    if (active.length === 0) return;
    const timer = setTimeout(
      () => {
        const now = Date.now();
        setWakeRequests(
          (previous) =>
            new Map(
              [...previous].map(([id, request]) => [
                id,
                request.deadline <= now ? { ...request, delayed: true } : request,
              ]),
            ),
        );
      },
      Math.max(0, Math.min(...active.map((request) => request.deadline)) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [wakeRequests]);

  // The zone comes from the hydration-safe `me` cache so the grouping
  // is identical on the server and in the first client render.
  const timeZone = useUserTimeZone();
  const grouped = useMemo(
    () => (now === null ? null : groupByWakeTime(rows, new Date(now), timeZone)),
    [rows, now, timeZone],
  );
  // Below `sm` (D60 mobile treatment) the 4-track row grid overflows a
  // phone viewport — resolve the breakpoint once and thread it to the
  // rows so each restacks to a single column.
  const isMobile = useIsAtMost('sm');

  return (
    <div
      style={{
        ...editorialColumnStyle,
        display: 'flex',
        flexDirection: 'column',
        gap: 32,
      }}
    >
      <EditorialKicker>Catch up / Coming back to you</EditorialKicker>
      <h1 style={editorialTitleStyle}>Later</h1>
      <EditorialDescription>Return times for the active inbox · {timeZone}</EditorialDescription>
      <ScreenIntro
        id="snoozed"
        title="Later"
        body="Email from these senders waits in Gmail's DeclutrMail/Later label until its return time."
      />

      {/* A failed return is announced ONCE, by the app-wide
          `LaterReturnAlert` in the chrome (same `retrying | missed`
          derivation server-side). This page used to repeat it in a
          second banner; the affected rows below carry the per-sender
          detail instead. */}

      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <SnoozedErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing in Later"
          description={
            <>
              Send a sender to <strong>Later</strong> from Triage or Senders.
              <br />
              <Link
                href="/senders"
                style={{ color: color.primary, display: 'inline-block', paddingTop: 12 }}
              >
                Browse senders →
              </Link>
            </>
          }
        />
      ) : grouped === null || now === null ? (
        <LoadingState />
      ) : (
        <>
          <style>{flatRowCss('dm-later-row')}</style>
          {/* One parent keeps each sender's draft, focus, and mutation observer
              mounted when the account calendar moves it to another bucket. */}
          <ul aria-label="Later senders" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {WAKE_BUCKETS.filter((bucket) => grouped[bucket].length > 0).flatMap(
              (bucket, index) => [
                <BucketHeading
                  key={`heading-${bucket}`}
                  bucket={bucket}
                  count={grouped[bucket].length}
                  first={index === 0}
                />,
                ...grouped[bucket].map((row) => (
                  <SnoozedRow
                    key={row.senderId}
                    row={row}
                    now={now}
                    waking={wakingIds.has(row.senderId)}
                    confirmationDelayed={wakeRequests.get(row.senderId)?.delayed ?? false}
                    onWakeStarted={(senderId) => {
                      const current = rows.find((candidate) => candidate.senderId === senderId);
                      if (!current) return;
                      setWakeRequests((previous) =>
                        new Map(previous).set(senderId, {
                          lastAttemptAt: current.lastReturnAttemptAt,
                          timer: `${current.snoozedAt}/${current.snoozedUntil}`,
                          deadline: Date.now() + WAKE_FAST_POLL_MS,
                          delayed: false,
                        }),
                      );
                    }}
                    isMobile={isMobile}
                  />
                )),
              ],
            )}
          </ul>
        </>
      )}
    </div>
  );
}

// ── Groups ────────────────────────────────────────────────────────────

function BucketHeading({
  bucket,
  count,
  first,
}: {
  bucket: WakeBucket;
  count: number;
  first: boolean;
}) {
  return (
    <li role="presentation" style={{ paddingTop: first ? 0 : 32, paddingBottom: 8 }}>
      <h2
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
          margin: 0,
          fontSize: text.lg,
          fontWeight: 650,
          letterSpacing: '-0.01em',
          color: color.fg,
        }}
      >
        {WAKE_BUCKET_LABELS[bucket]}
        <span
          style={{
            color: color.fgMuted,
            fontSize: text.md,
            fontWeight: 500,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          · {count}
        </span>
      </h2>
    </li>
  );
}

// ── Rows ──────────────────────────────────────────────────────────────

type RowPanel = 'closed' | 'confirm-wake' | 'snooze-menu';

export function SnoozedRow({
  now,
  row,
  waking,
  confirmationDelayed = false,
  onWakeStarted,
  isMobile = false,
}: {
  now: number;
  row: SnoozedSenderRow;
  waking: boolean;
  confirmationDelayed?: boolean;
  onWakeStarted: (senderId: string) => void;
  /** Below `sm` the row restacks to a single column (D60). */
  isMobile?: boolean;
}) {
  const [panel, setPanel] = useState<RowPanel>('closed');
  const wake = useWakeNow();
  const timeZone = useUserTimeZone();

  const name = row.displayName.trim().length > 0 ? row.displayName : row.email;
  const countLabel = row.laterCount === null ? 'count syncing…' : `${row.laterCount} in Later`;
  const returnIssue = returnIssueCopy(row);

  const startWake = () => {
    void track('wake_now_clicked', {
      sender_id: row.senderId,
      later_count: row.laterCount ?? -1,
    });
    wake.mutate(
      { senderId: row.senderId },
      {
        onSuccess: () => {
          onWakeStarted(row.senderId);
          setPanel('closed');
        },
      },
    );
  };

  return (
    <li
      className="dm-later-row"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        fontFamily: font.sans,
      }}
    >
      <div
        style={{
          display: 'grid',
          // Mobile (D60): identity · count · wake-status · actions each
          // take a full-width row so nothing clips on a phone.
          gridTemplateColumns: isMobile
            ? '1fr'
            : 'minmax(180px, 1.4fr) auto minmax(140px, 1fr) auto',
          alignItems: isMobile ? 'start' : 'center',
          gap: isMobile ? 10 : 16,
          minHeight: 64,
          boxSizing: 'border-box',
          padding: '12px 0',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: text.md,
              fontWeight: 600,
              color: color.fg,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </div>
          <div style={{ fontSize: text.sm, color: color.fgMuted, marginTop: 2 }}>{row.domain}</div>
        </div>

        <span
          style={{
            fontSize: text.sm,
            fontWeight: 600,
            color: color.fgSoft,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {countLabel}
        </span>

        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: text.sm,
              color: color.fg,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {waking
              ? 'Bringing back…'
              : row.returnStatus === 'retrying'
                ? 'Return retrying'
                : row.returnStatus === 'missed'
                  ? 'Return overdue'
                  : row.returnStatus === 'returning'
                    ? 'Returning now…'
                    : `Returns ${formatWakeTime(row.snoozedUntil, new Date(now), timeZone)}`}
          </div>
          {confirmationDelayed ? (
            <div role="status" style={{ fontSize: text.sm, color: color.fgMuted }}>
              Return requested; confirmation is taking longer than expected. Status refreshes
              automatically.
            </div>
          ) : null}
          {returnIssue ? (
            <div style={{ fontSize: text.sm, color: color.danger }}>{returnIssue}</div>
          ) : null}
          {row.returnStatus === 'retrying' && row.lastReturnAttemptAt ? (
            <div
              style={{
                fontSize: text.xs,
                color: color.fgMuted,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              Last tried {formatLastAttempt(row.lastReturnAttemptAt, timeZone)}
            </div>
          ) : null}
          {row.reason ? (
            <div
              title={row.reason}
              style={{
                fontSize: text.xs,
                color: color.fgMuted,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              “{row.reason}”
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap' }}>
          <Button
            tone="default"
            size="sm"
            disabled={waking || wake.isPending}
            onClick={() => setPanel(panel === 'snooze-menu' ? 'closed' : 'snooze-menu')}
          >
            Change return time
          </Button>
          <Button
            tone="default"
            size="sm"
            disabled={waking || wake.isPending}
            onClick={() => setPanel(panel === 'confirm-wake' ? 'closed' : 'confirm-wake')}
          >
            Bring back now
          </Button>
        </div>
      </div>

      {panel === 'confirm-wake' && !waking ? (
        <WakeConfirm
          row={row}
          pending={wake.isPending}
          error={wake.isError ? wake.error : null}
          onConfirm={startWake}
          onCancel={() => setPanel('closed')}
        />
      ) : null}

      {panel === 'snooze-menu' && !waking ? (
        <SnoozeMenu row={row} now={now} onClose={() => setPanel('closed')} />
      ) : null}
    </li>
  );
}

/**
 * Locale + zone pinned: the row is server-rendered into hydrated HTML
 * on /later, so both halves must be deterministic (React #418; e2e
 * hydration-smoke). Exported for the exact-string unit test.
 */
export function formatLastAttempt(iso: string, timeZone: string): string {
  const attemptedAt = new Date(iso);
  if (Number.isNaN(attemptedAt.getTime())) return 'at an unknown time';
  return attemptedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone });
}

function returnIssueCopy(row: SnoozedSenderRow): string | null {
  if (row.returnStatus === 'missed') {
    return 'No successful return is confirmed; check the inbox or Later label.';
  }
  if (row.returnStatus !== 'retrying') return null;
  if (row.returnFailureKind === 'reauthorize') {
    return 'Reconnect Gmail, then choose Bring back now.';
  }
  if (row.returnFailureKind === 'needs_attention') {
    return 'Choose Bring back now. If it fails again, use Help in Settings.';
  }
  return 'Return is unconfirmed; automatic retry remains active.';
}

/**
 * Preview-light confirm for Wake now (see screen docstring). States
 * exactly what will change BEFORE the mutation — count, label, inbox —
 * with the real number from the mirror, or honest copy when unknown.
 */
function WakeConfirm({
  row,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  row: SnoozedSenderRow;
  pending: boolean;
  error: Error | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const what =
    row.laterCount === null
      ? 'Everything from this sender in DeclutrMail/Later returns to your inbox now, and the return time clears'
      : row.laterCount === 0
        ? 'No email is in the Later label — this clears the return time'
        : `${row.laterCount} email${row.laterCount === 1 ? '' : 's'} return${row.laterCount === 1 ? 's' : ''} to your inbox now, and the return time clears`;
  return (
    <div
      style={{
        padding: '4px 0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ width: '100%' }}>
        <MailboxActionContext />
      </div>
      <span style={{ fontSize: text.md, color: color.fg, fontVariantNumeric: 'tabular-nums' }}>
        {what}.
      </span>
      <span style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
        <Button tone="default" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button tone="primary" onClick={onConfirm} disabled={pending}>
          {pending ? 'Starting…' : 'Bring back now'}
        </Button>
      </span>
      {error ? (
        <span role="alert" style={{ fontSize: text.sm, color: color.danger, width: '100%' }}>
          {error instanceof ApiError && error.status === 503
            ? "The return schedule isn't available right now. Try again in a moment."
            : "Couldn't start the return. Try again in a moment."}
        </span>
      ) : null}
    </div>
  );
}

/** D82/D245 — preset durations + custom date/time + optional note. */
function SnoozeMenu({
  row,
  now,
  onClose,
}: {
  row: SnoozedSenderRow;
  now: number;
  onClose: () => void;
}) {
  const setSnooze = useSetSnooze();
  const [reason, setReason] = useState(row.reason ?? '');
  const [custom, setCustom] = useState('');
  // Presets resolve in the user zone — the zone the rows display in —
  // so the saved instant reads back as the wall time that was picked.
  const timeZone = useUserTimeZone();
  const presets = useMemo(() => snoozePresets(new Date(now), timeZone), [now, timeZone]);

  const submit = (until: string, presetId: SnoozePresetEventId) => {
    const trimmed = reason.trim();
    setSnooze.mutate(
      {
        senderId: row.senderId,
        body: { until, ...(trimmed.length > 0 ? { reason: trimmed } : {}) },
      },
      {
        onSuccess: () => {
          void track('snooze_set', {
            sender_id: row.senderId,
            preset: presetId,
            has_reason: trimmed.length > 0,
          });
          onClose();
        },
      },
    );
  };

  const customValid = custom !== '' && new Date(custom).getTime() > now;

  return (
    <div
      style={{
        padding: '4px 0 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {presets.map((preset) => (
          <Button
            key={preset.id}
            tone="default"
            size="sm"
            disabled={setSnooze.isPending}
            onClick={() => submit(preset.at.toISOString(), preset.id)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label
          style={{
            fontSize: text.sm,
            color: color.fgMuted,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Custom
          <input
            type="datetime-local"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            style={{
              fontSize: text.sm,
              fontFamily: font.sans,
              height: 36,
              boxSizing: 'border-box',
              padding: '0 12px',
              border: 'none',
              borderRadius: radius.md,
              background: color.fill,
              color: color.fg,
            }}
          />
        </label>
        <Button
          tone="default"
          disabled={!customValid || setSnooze.isPending}
          onClick={() => submit(new Date(custom).toISOString(), 'custom')}
        >
          Set
        </Button>
        <input
          type="text"
          placeholder="Note (optional)"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          style={{
            flex: 1,
            minWidth: 160,
            fontSize: text.sm,
            fontFamily: font.sans,
            height: 36,
            boxSizing: 'border-box',
            padding: '0 12px',
            border: 'none',
            borderRadius: radius.md,
            background: color.fill,
            color: color.fg,
          }}
        />
        <Button
          tone="default"
          onClick={onClose}
          disabled={setSnooze.isPending}
          ariaLabel={`Cancel return-time changes for ${row.displayName || row.email}`}
        >
          Cancel
        </Button>
      </div>

      {setSnooze.isError ? (
        <span role="alert" style={{ fontSize: text.sm, color: color.danger }}>
          Couldn&rsquo;t update the return time. Try again in a moment.
        </span>
      ) : null}
    </div>
  );
}

// ── Loading / error branches (D211 edge states) ───────────────────────

function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{ height: 56, borderTop: `1px solid ${color.line}` }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading Later senders</span>
    </div>
  );
}

function SnoozedErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div
      style={{
        fontFamily: font.sans,
      }}
    >
      <ErrorState
        title="We couldn't load Later"
        description={loadErrorDescription(error)}
        onRetry={onRetry}
      />
    </div>
  );
}
