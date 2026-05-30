'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import { Avatar, Button, EmptyState, ScreenIntro, tokens } from '@declutrmail/shared';

import { ApiError } from '@/lib/api/client';
import type {
  ActivityActionWire,
  ActivityRowWire,
  ActivitySourceFilterWire,
  ActivityStatsWire,
  ActivityWindowWire,
} from '@/lib/api/activity';

import { useActivity } from './api/use-activity';

const { color, font } = tokens;

/**
 * Activity screen (D55-D60, tracer-bullet).
 *
 * Layout:
 *   1. ScreenIntro
 *   2. Stats header — D59 mono single-line summary
 *      ("This window: N archived · M unsubscribed · K kept …")
 *   3. Source chips — D56 partial (4 chips + All; "Senders" / "Brief"
 *      chips deferred until activity_source enum extension)
 *   4. Window picker — D55 (Last 7d / Last 30d default / Last 90d / All)
 *   5. Row list — collapsed row only for this tracer (D57 accordion
 *      expansion lands in follow-up)
 *
 * D58 undo affordance is RENDER-ONLY in this PR: the pre-resolved
 * `undoState` carries the right discriminant so the UI shows the
 * correct label per row ("Undo →" / "Undone" / "Undo expired"); the
 * `POST /api/undo/:token` wire-up belongs alongside the action-pipeline
 * mutation surfaces (ADR-0013 spec) and is intentionally not in this
 * tracer. Clicking the live undo button is a no-op until that lands —
 * documented inline on the button.
 *
 * State: URL query params drive both filters (D55, D56) for deep-link
 * support. The router is the single source of truth; the component
 * reads `?window=…&source=…` and re-fetches on change.
 *
 * Cache effect on mailbox switch: query key is partitioned by
 * (window, source) but NOT mailbox; relies on `resetMailboxScopedCache`
 * (CLAUDE.md §8 invariant — already names brief / triage / senders /
 * activity-style keys by design).
 *
 * Privacy (D7, D228): sender identity, action verb, count, timestamp,
 * undo token only. No body, no snippet, no headers.
 */
export function ActivityScreen() {
  const router = useRouter();
  const params = useSearchParams();

  const window = readWindow(params.get('window'));
  const source = readSource(params.get('source'));

  const query = useActivity(window, source);

  const setWindow = useCallback(
    (next: ActivityWindowWire) => {
      const sp = new URLSearchParams(params.toString());
      sp.set('window', next);
      router.replace(`/activity?${sp.toString()}`);
    },
    [params, router],
  );
  const setSource = useCallback(
    (next: ActivitySourceFilterWire) => {
      const sp = new URLSearchParams(params.toString());
      if (next === 'all') sp.delete('source');
      else sp.set('source', next);
      router.replace(`/activity?${sp.toString()}`);
    },
    [params, router],
  );

  if (query.isLoading) return <LoadingState />;
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }

  const env = query.data!;
  const rows = env.data;
  const stats = env.meta?.stats;

  return (
    <div
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 980,
        fontFamily: font.sans,
      }}
    >
      <ScreenIntro
        id="activity"
        title="Activity"
        body="Every decision taken on your mail — by you, by Autopilot, by your rules. Filter by source or time window; undo destructive actions within their 7-day window."
        tip="An empty list within a short window is fine — it means nothing changed. Widen the window to see history."
      />

      {stats && <StatsHeader stats={stats} window={window} />}
      <SourceChips active={source} onSelect={setSource} />
      <WindowPicker active={window} onSelect={setWindow} />

      {rows.length === 0 ? (
        <EmptyState
          title="No activity in this window."
          description={
            <>
              Try widening the time range or switching the source filter — the activity log is
              append-only, so nothing has been removed.
            </>
          }
        />
      ) : (
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
            <ActivityRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Stats header (D59) ────────────────────────────────────────────────

function StatsHeader({ stats, window }: { stats: ActivityStatsWire; window: ActivityWindowWire }) {
  const windowLabel = windowToLabel(window);
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        fontFamily: font.mono,
        fontSize: 12.5,
        color: color.fgMuted,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <strong style={{ color: color.fg, fontWeight: 600, textTransform: 'lowercase' }}>
        {windowLabel}:
      </strong>
      <span>{stats.archived} archived</span>
      <Sep />
      <span>{stats.unsubscribed} unsubscribed</span>
      <Sep />
      <span>{stats.kept} kept</span>
      <Sep />
      <span>{stats.later} later</span>
      <Sep />
      <span>{stats.needsAttention} needing attention</span>
    </div>
  );
}

function Sep() {
  return <span aria-hidden="true">·</span>;
}

// ── Source chips (D56, partial) ───────────────────────────────────────

const SOURCE_CHIPS: ReadonlyArray<{ value: ActivitySourceFilterWire; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'triage', label: 'Triage' },
  { value: 'autopilot', label: 'Autopilot' },
  { value: 'screener', label: 'Screener' },
  { value: 'manual', label: 'Manual' },
];

function SourceChips({
  active,
  onSelect,
}: {
  active: ActivitySourceFilterWire;
  onSelect: (next: ActivitySourceFilterWire) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter by source"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
    >
      {SOURCE_CHIPS.map((chip) => (
        <Chip
          key={chip.value}
          label={chip.label}
          isActive={active === chip.value}
          onClick={() => onSelect(chip.value)}
        />
      ))}
    </div>
  );
}

// ── Window picker (D55) ───────────────────────────────────────────────

const WINDOWS: ReadonlyArray<{ value: ActivityWindowWire; label: string }> = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

function WindowPicker({
  active,
  onSelect,
}: {
  active: ActivityWindowWire;
  onSelect: (next: ActivityWindowWire) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Time window"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
    >
      {WINDOWS.map((opt) => (
        <Chip
          key={opt.value}
          label={opt.label}
          isActive={active === opt.value}
          onClick={() => onSelect(opt.value)}
          tone="muted"
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  isActive,
  onClick,
  tone = 'accent',
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  tone?: 'accent' | 'muted';
}) {
  const activeBg = tone === 'accent' ? color.primary : color.fg;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      style={{
        padding: '4px 12px',
        fontSize: 12,
        fontFamily: font.sans,
        border: `1px solid ${isActive ? activeBg : color.lineSoft}`,
        background: isActive ? activeBg : 'transparent',
        color: isActive ? '#FFFFFF' : color.fg,
        borderRadius: 999,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// ── Row ───────────────────────────────────────────────────────────────

function ActivityRow({ row }: { row: ActivityRowWire }) {
  const senderName = row.sender?.displayName ?? 'Account-scoped action';
  const senderEmail = row.sender?.email ?? '';
  const senderDomain = row.sender?.domain ?? '';
  const verbLabel = ACTION_LABEL[row.action];
  const sourceLabel = SOURCE_LABEL[row.source];
  const relative = relativeTime(row.occurredAt);
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(180px, 1.2fr) minmax(140px, 1fr) auto auto auto',
        alignItems: 'center',
        gap: 14,
        padding: '12px 14px',
        background: color.card,
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 10,
        fontFamily: font.sans,
      }}
    >
      <Avatar size={32} name={senderName} domain={senderEmail} />
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
          {senderName}
        </div>
        {senderDomain && (
          <div style={{ fontSize: 12, color: color.fgMuted, fontFamily: font.mono }}>
            {senderDomain}
          </div>
        )}
      </div>
      <div style={{ fontSize: 13, color: color.fg }}>
        <strong style={{ fontWeight: 600 }}>{verbLabel}</strong>
        {row.affectedCount > 0 && (
          <span style={{ color: color.fgMuted }}>
            {' '}
            · {row.affectedCount} email{row.affectedCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <SourcePill label={sourceLabel} />
      <UndoCell undo={row.undoState} />
      <div
        style={{
          fontSize: 12,
          color: color.fgMuted,
          fontFamily: font.mono,
          whiteSpace: 'nowrap',
        }}
      >
        {relative}
      </div>
    </li>
  );
}

function SourcePill({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontFamily: font.mono,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: color.fgMuted,
        padding: '2px 8px',
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 6,
      }}
    >
      {label}
    </span>
  );
}

/**
 * D58 — render-only undo state. The wire-up to `POST /api/undo/:token`
 * is intentionally NOT included in this tracer; the button shows the
 * correct affordance but does nothing on click. Title attribute makes
 * the deferred behavior discoverable for the founder during smoke.
 */
function UndoCell({ undo }: { undo: ActivityRowWire['undoState'] }) {
  if (undo.kind === 'available') {
    return (
      <button
        type="button"
        title="Undo wiring lands with the action-pipeline mutation surface (ADR-0013); button is render-only in this tracer."
        style={{
          fontSize: 12.5,
          color: color.primary,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
        }}
      >
        Undo →
      </button>
    );
  }
  if (undo.kind === 'executed') {
    return (
      <span style={{ fontSize: 11, color: color.fgMuted, fontFamily: font.mono }}>UNDONE</span>
    );
  }
  if (undo.kind === 'expired') {
    return (
      <span
        title={`Undo window closed on ${formatExpiry(undo.expiredAt)}.`}
        style={{ fontSize: 11, color: color.fgMuted, fontFamily: font.mono }}
      >
        UNDO EXPIRED
      </span>
    );
  }
  return <span aria-hidden="true" />;
}

// ── Edge states ───────────────────────────────────────────────────────

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
        maxWidth: 980,
      }}
    >
      {[48, 56, 56, 56, 56, 56].map((h, i) => (
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
      <span style={{ position: 'absolute', left: -9999 }}>Loading activity</span>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError
      ? `We couldn't load your activity (${error.status}). Try again in a moment.`
      : "We couldn't load your activity right now. Try again in a moment.";
  return (
    <div style={{ padding: '20px 24px 28px', maxWidth: 720, fontFamily: font.sans }}>
      <EmptyState
        title="We couldn't load your activity"
        description={message}
        action={
          <Button tone="primary" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

const ACTION_LABEL: Record<ActivityActionWire, string> = {
  keep: 'Kept',
  archive: 'Archived',
  unsubscribe: 'Unsubscribed',
  later: 'Later',
  'followup-dismiss': 'Followup resolved',
};

const SOURCE_LABEL: Record<ActivityRowWire['source'], string> = {
  triage: 'Triage',
  manual: 'Manual',
  autopilot: 'Autopilot',
  screener: 'Screener',
};

function readWindow(raw: string | null): ActivityWindowWire {
  if (raw === '7d' || raw === '30d' || raw === '90d' || raw === 'all') return raw;
  return '30d';
}

function readSource(raw: string | null): ActivitySourceFilterWire {
  if (raw === 'triage' || raw === 'manual' || raw === 'autopilot' || raw === 'screener') {
    return raw;
  }
  return 'all';
}

function windowToLabel(window: ActivityWindowWire): string {
  switch (window) {
    case '7d':
      return 'This week';
    case '30d':
      return 'This window (30 days)';
    case '90d':
      return 'This window (90 days)';
    case 'all':
      return 'All time';
  }
}

/**
 * Coarse "N days/hours/min ago" formatter for the row meta. Bounded to
 * the buckets the screen displays — proper l10n is a follow-up.
 */
export function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = Math.max(0, nowMs - then);
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  if (minutes >= 1) return `${minutes}m ago`;
  return 'just now';
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
