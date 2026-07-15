'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  Button,
  EmptyState,
  ErrorState,
  ScreenIntro,
  tokens,
  useIsAtMost,
} from '@declutrmail/shared';
import { buildActionPresentation } from '@declutrmail/shared/actions';
import type { EventPayloads } from '@declutrmail/shared/observability';

import { MailboxActionContext } from '@/features/auth/mailbox-action-context';
import { ApiError } from '@/lib/api/client';
import type { SnoozedSenderRow } from '@/lib/api/snoozed';
import { track } from '@/lib/posthog';

import { useSetSnooze, useSnoozed, useWakeNow } from './api/use-snoozed';
import {
  formatWakeTime,
  groupByWakeTime,
  snoozePresets,
  WAKE_BUCKET_LABELS,
  WAKE_BUCKETS,
  type WakeBucket,
} from './snooze-times';

const { color, font } = tokens;

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
 *   - **Change wake time ▾** — D82 presets + custom date/time
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
export function SnoozedScreen() {
  // Senders with an in-flight wake — drives the poll window.
  const [wakingIds, setWakingIds] = useState<ReadonlySet<string>>(new Set());
  const query = useSnoozed({ refetchInterval: wakingIds.size > 0 ? 2_000 : 60_000 });

  // `mailbox_id: null` — the screen deliberately avoids `useAuth()` so
  // its Storybook stories (the D211 inventory's coverage evidence)
  // mount without an auth shim; PostHog `identify` ties the event to
  // the user regardless.
  useEffect(() => {
    void track('page_viewed', { page: 'snoozed', mailbox_id: null });
  }, []);

  // A waking sender that left the list is DONE — stop tracking it.
  const rows = useMemo(() => query.data ?? [], [query.data]);
  useEffect(() => {
    if (wakingIds.size === 0) return;
    const present = new Set(rows.map((r) => r.senderId));
    const still = new Set([...wakingIds].filter((id) => present.has(id)));
    if (still.size !== wakingIds.size) {
      setWakingIds(still);
    }
  }, [rows, wakingIds]);

  const grouped = useMemo(() => groupByWakeTime(rows, new Date()), [rows]);
  const returnIssues = rows.filter(
    (row) => row.returnStatus === 'retrying' || row.returnStatus === 'missed',
  );

  // Below `sm` (D60 mobile treatment) the 4-track row grid overflows a
  // phone viewport — resolve the breakpoint once and thread it to the
  // rows so each restacks to a single column.
  const isMobile = useIsAtMost('sm');

  if (query.isLoading) {
    return <LoadingState />;
  }
  if (query.isError) {
    return <SnoozedErrorState error={query.error} onRetry={() => query.refetch()} />;
  }

  return (
    <div
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        maxWidth: 920,
        fontFamily: font.sans,
      }}
    >
      <ScreenIntro
        id="snoozed"
        title="Later"
        body="Senders you sent to Later. Their mail sits in the DeclutrMail/Later label in Gmail — out of your inbox, one click away — and comes back at the wake time you choose."
        tip="Wake now brings everything back immediately. Nothing is unsubscribed or deleted from here."
      />

      {returnIssues.length > 0 ? <LaterPageReturnAlert rows={returnIssues} /> : null}

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing in Later."
          description={
            <>
              Send a sender to <strong>Later</strong> from Triage or Senders and it lands here, with
              its mail tucked into the DeclutrMail/Later label until you bring it back.
            </>
          }
        />
      ) : (
        WAKE_BUCKETS.map((bucket) =>
          grouped[bucket].length > 0 ? (
            <BucketGroup
              key={bucket}
              bucket={bucket}
              rows={grouped[bucket]}
              wakingIds={wakingIds}
              onWakeStarted={(senderId) => setWakingIds((prev) => new Set([...prev, senderId]))}
              isMobile={isMobile}
            />
          ) : null,
        )
      )}
    </div>
  );
}

function LaterPageReturnAlert({ rows }: { rows: SnoozedSenderRow[] }) {
  const reconnectRequired = rows.some((row) => row.returnFailureKind === 'reauthorize');
  const supportRequired = rows.some((row) => row.returnFailureKind === 'needs_attention');
  return (
    <div
      role="status"
      style={{
        padding: '12px 14px',
        borderRadius: 10,
        border: `1px solid ${color.dangerBorder}`,
        background: color.dangerBg,
        color: color.danger,
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {rows.length} Later return{rows.length === 1 ? '' : 's'} need attention. DeclutrMail could not
      confirm the return; nothing will be deleted. Check the inbox or Gmail&apos;s DeclutrMail/Later
      label.{' '}
      {supportRequired
        ? 'Choose Wake now once. If it still fails, use Help in Settings.'
        : reconnectRequired
          ? 'Reconnect Gmail from the account menu, then choose Wake now.'
          : 'DeclutrMail will keep retrying automatically, or choose Wake now to retry immediately.'}
    </div>
  );
}

// ── Groups ────────────────────────────────────────────────────────────

function BucketGroup({
  bucket,
  rows,
  wakingIds,
  onWakeStarted,
  isMobile,
}: {
  bucket: WakeBucket;
  rows: SnoozedSenderRow[];
  wakingIds: ReadonlySet<string>;
  onWakeStarted: (senderId: string) => void;
  isMobile: boolean;
}) {
  const label = WAKE_BUCKET_LABELS[bucket];
  return (
    <section
      aria-label={`${label} (${rows.length})`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <h2
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          margin: 0,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: color.fgSoft,
          fontFamily: font.mono,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: color.amber,
          }}
        />
        {label}
        <span style={{ color: color.fgMuted, fontWeight: 500 }}>· {rows.length}</span>
      </h2>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {rows.map((row) => (
          <SnoozedRow
            key={row.senderId}
            row={row}
            waking={wakingIds.has(row.senderId)}
            onWakeStarted={onWakeStarted}
            isMobile={isMobile}
          />
        ))}
      </ul>
    </section>
  );
}

// ── Rows ──────────────────────────────────────────────────────────────

type RowPanel = 'closed' | 'confirm-wake' | 'snooze-menu';

export function SnoozedRow({
  row,
  waking,
  onWakeStarted,
  isMobile = false,
}: {
  row: SnoozedSenderRow;
  waking: boolean;
  onWakeStarted: (senderId: string) => void;
  /** Below `sm` the row restacks to a single column (D60). */
  isMobile?: boolean;
}) {
  const [panel, setPanel] = useState<RowPanel>('closed');
  const wake = useWakeNow();

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
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        background: color.card,
        border: `1px solid ${returnIssue ? color.dangerBorder : color.lineSoft}`,
        borderRadius: 10,
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
          gap: isMobile ? 10 : 14,
          padding: '12px 14px',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: color.fg,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </div>
          <div style={{ fontSize: 12, color: color.fgMuted, fontFamily: font.mono }}>
            {row.domain}
          </div>
        </div>

        <span
          style={{
            fontSize: 12,
            color: color.fgMuted,
            fontFamily: font.mono,
            whiteSpace: 'nowrap',
          }}
        >
          {countLabel}
        </span>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: color.fg, whiteSpace: 'nowrap' }}>
            {waking
              ? 'Waking…'
              : row.returnStatus === 'retrying'
                ? 'Return retrying'
                : row.returnStatus === 'missed'
                  ? 'Return overdue'
                  : row.returnStatus === 'returning'
                    ? 'Returning now…'
                    : `Wakes ${formatWakeTime(row.snoozedUntil, new Date())}`}
          </div>
          {returnIssue ? (
            <div style={{ fontSize: 11.5, color: color.danger }}>{returnIssue}</div>
          ) : null}
          {row.returnStatus === 'retrying' && row.lastReturnAttemptAt ? (
            <div style={{ fontSize: 11.5, color: color.fgMuted }}>
              Last tried {formatLastAttempt(row.lastReturnAttemptAt)}
            </div>
          ) : null}
          {row.reason ? (
            <div
              title={row.reason}
              style={{
                fontSize: 11.5,
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
            disabled={waking || wake.isPending}
            onClick={() => setPanel(panel === 'snooze-menu' ? 'closed' : 'snooze-menu')}
          >
            Change wake time ▾
          </Button>
          <Button
            tone="primary"
            disabled={waking || wake.isPending}
            onClick={() => setPanel(panel === 'confirm-wake' ? 'closed' : 'confirm-wake')}
          >
            Wake now
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
        <SnoozeMenu row={row} onClose={() => setPanel('closed')} />
      ) : null}
    </li>
  );
}

function formatLastAttempt(iso: string): string {
  const attemptedAt = new Date(iso);
  if (Number.isNaN(attemptedAt.getTime())) return 'at an unknown time';
  return attemptedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function returnIssueCopy(row: SnoozedSenderRow): string | null {
  if (row.returnStatus === 'missed') {
    return 'No successful return is confirmed; check the inbox or Later label.';
  }
  if (row.returnStatus !== 'retrying') return null;
  if (row.returnFailureKind === 'reauthorize') {
    return 'Reconnect Gmail, then choose Wake now.';
  }
  if (row.returnFailureKind === 'needs_attention') {
    return 'Choose Wake now. If it fails again, use Help in Settings.';
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
  const presentation = buildActionPresentation({
    verb: 'unarchive',
    liveCount: row.laterCount,
    planUndoDeadline: null,
    wakeAt: null,
    unsubscribeChannel: null,
  }).primary;
  const what =
    row.laterCount === null
      ? 'Everything from this sender in the DeclutrMail/Later label moves back to your inbox'
      : row.laterCount === 0
        ? 'No mail is currently in the Later label — this clears the wake timer'
        : `${row.laterCount} message${row.laterCount === 1 ? '' : 's'} move${row.laterCount === 1 ? 's' : ''} from DeclutrMail/Later back to your inbox`;
  return (
    <div
      style={{
        borderTop: `1px solid ${color.lineSoft}`,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ width: '100%' }}>
        <MailboxActionContext />
      </div>
      <span style={{ fontSize: 12.5, color: color.fg }}>
        {what}. {presentation.futureMail.summary} {presentation.unchanged.join(' ')} The wake timer
        clears.
      </span>
      <span style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
        <Button tone="default" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button tone="primary" onClick={onConfirm} disabled={pending}>
          {pending ? 'Queuing…' : 'Wake now'}
        </Button>
      </span>
      {error ? (
        <span role="alert" style={{ fontSize: 12, color: color.red, width: '100%' }}>
          {error instanceof ApiError && error.status === 503
            ? "The wake queue isn't available right now. Try again in a moment."
            : "Couldn't queue the wake. Try again in a moment."}
        </span>
      ) : null}
    </div>
  );
}

/** D82/D245 — preset durations + custom date/time + optional note. */
function SnoozeMenu({ row, onClose }: { row: SnoozedSenderRow; onClose: () => void }) {
  const setSnooze = useSetSnooze();
  const [reason, setReason] = useState(row.reason ?? '');
  const [custom, setCustom] = useState('');
  const presets = useMemo(() => snoozePresets(new Date()), []);

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

  const customValid = custom !== '' && new Date(custom).getTime() > Date.now();

  return (
    <div
      style={{
        borderTop: `1px solid ${color.lineSoft}`,
        padding: '10px 14px 12px',
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
            fontSize: 12,
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
              fontSize: 12.5,
              fontFamily: font.sans,
              padding: '5px 8px',
              border: `1px solid ${color.lineSoft}`,
              borderRadius: 7,
              background: 'transparent',
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
            fontSize: 12.5,
            fontFamily: font.sans,
            padding: '5px 8px',
            border: `1px solid ${color.lineSoft}`,
            borderRadius: 7,
            background: 'transparent',
            color: color.fg,
          }}
        />
        <Button
          tone="default"
          onClick={onClose}
          disabled={setSnooze.isPending}
          ariaLabel={`Cancel wake-time changes for ${row.displayName || row.email}`}
        >
          Cancel
        </Button>
      </div>

      {setSnooze.isError ? (
        <span role="alert" style={{ fontSize: 12, color: color.red }}>
          Couldn&rsquo;t update the wake time. Try again in a moment.
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
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxWidth: 920,
      }}
    >
      {[56, 56, 56, 56].map((h, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            height: h,
            background: color.card,
            border: `1px solid ${color.lineSoft}`,
            borderRadius: 10,
          }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading Later senders</span>
    </div>
  );
}

function SnoozedErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError
      ? `We couldn't load your Later senders (${error.status}). Try again in a moment.`
      : "We couldn't load your Later senders right now. Try again in a moment.";
  return (
    <div style={{ padding: '20px 24px 28px', maxWidth: 720, fontFamily: font.sans }}>
      <ErrorState title="We couldn't load Later" description={message} onRetry={onRetry} />
    </div>
  );
}
