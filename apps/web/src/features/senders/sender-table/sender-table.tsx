'use client';

/**
 * SenderTable — flat, sortable, accessible table for the Senders screen
 * (Slice 1 / Step 6, ADR-0014, docs/api/senders-list-contract.md).
 *
 * Architecture notes:
 *
 * 1. **Real semantic table.** `<table>` + `<thead>` + `<tbody>` + `<th>` +
 *    `<td>`. Sortable columns use `<button>` inside `<th>` with
 *    `aria-sort` on the header. The earlier "grid + role=row" pattern
 *    rejected by the handoff because the assistive-tech sort semantics
 *    do not carry through a div-grid; sort announcements only work on
 *    a real `<th aria-sort>`.
 *
 * 2. **Row is NOT `role=button`.** The chevron in the trailing column
 *    is the dedicated expand control. Checkbox, verbs, and the chevron
 *    are siblings — never nested interactives, never a clickable row
 *    that wraps three clickable children. Clicking the row body is a
 *    no-op so a screen reader sees a single landmark per cell.
 *
 * 3. **Magnitude bar scales to `meta.query.globalMaxTotal`.** Mailbox-
 *    wide UNFILTERED max — a filtered view does NOT rescale to its own
 *    max, so bars stay comparable across filter changes (per contract).
 *    When `globalMaxTotal` is 0 the bar is suppressed (empty mailbox).
 *
 * 4. **Verbs route through D226 preview.** `onAction` is the wire to
 *    `ConfirmActionModal`; the table NEVER optimistically mutates. K/A/U/L
 *    label vocabulary is locked by D227.
 *
 * 5. **State coverage.** `loading` renders a skeleton that PRESERVES the
 *    column header set so re-renders on sort/filter change do not jump
 *    layout. `error` renders an in-table error row with retry. `rows.length
 *    === 0` renders an empty state cell with `emptyKind` discriminator
 *    so callers can swap copy (no-senders / no-filter-match / no-search-
 *    match) without forking the component.
 *
 * 6. **Density toggle.** `density` switches row padding only — the column
 *    layout stays stable so a density flip never reflows columns.
 *
 * 7. **Sticky header.** `<thead>` is `position: sticky` so the header
 *    stays visible during long scrolls. Bottom border carries the line
 *    color so the header reads as separated even when scrolled under
 *    other content.
 *
 * 8. **Privacy.** No body / snippet / attachment ever surfaces. Only the
 *    D7 allowlist fields render — sender identity, dates, derived counts,
 *    Gmail labels, read state.
 *
 * Slice 1 + Step 6 scope: this component is feature-owned. Step 7 will
 * wire it into `senders-screen.tsx` behind the existing Grid/Table view
 * toggle.
 */

import type { CSSProperties } from 'react';
import { useState } from 'react';
import { tokens } from '@declutrmail/shared';
import { getActionDescriptor } from '@declutrmail/shared/actions';

import type {
  SenderListDirection,
  SenderListRow,
  SenderListSort,
  UnsubscribeMethod,
  VolumeTrendBucket,
} from '@/lib/api/senders';

const { color, font, radius, text } = tokens;

/** Discriminator for the empty-state cell when `rows.length === 0`. */
export type SenderTableEmptyKind = 'no-senders' | 'no-filter-match' | 'no-search-match';

/** Row-level verb the table emits up to the consumer. K/A/U/L (D227). */
export type SenderTableVerb = 'keep' | 'archive' | 'unsubscribe' | 'later';

export interface SenderTableProps {
  /** Page rows in the order the wire returned them (BE-sorted). */
  rows: readonly SenderListRow[];
  /**
   * `MAX(total_received)` for the active mailbox, UNFILTERED. Drives the
   * magnitude-bar denominator (per ADR-0014 + senders list contract).
   * Pass page-1's `meta.query.globalMaxTotal` and PRESERVE it across the
   * scroll — subsequent pages return their own value but the client
   * holds page-1's authoritative number.
   */
  globalMaxTotal: number;
  /** Active sort column. Server-side default is `'total'`. */
  sort: SenderListSort;
  /** Active sort direction. Server picks a sane default per sort. */
  direction: SenderListDirection;
  /**
   * Sort change handler. Toggling the active column flips direction;
   * clicking an inactive column sets it to its default direction (desc
   * for time + total, asc for name).
   */
  onSortChange(next: { sort: SenderListSort; direction: SenderListDirection }): void;
  /** Set of selected sender ids (cross-page). */
  selectedIds: ReadonlySet<string>;
  /** Selection change handler — caller owns the bulk semantics. */
  onSelectionChange(next: ReadonlySet<string>): void;
  /**
   * Verb invocation. Caller routes the call through D226's
   * `ConfirmActionModal`; the table NEVER mutates optimistically.
   */
  onAction(args: { verb: SenderTableVerb; sender: SenderListRow }): void;
  /** Loading state — renders a column-stable skeleton. */
  loading?: boolean | undefined;
  /** Page error — caller wires the retry on `onRetry`. */
  error?: { message: string } | null | undefined;
  /** Retry handler invoked from the in-table error row. */
  onRetry?: (() => void) | undefined;
  /** Empty-state copy discriminator. Only used when `rows.length === 0`. */
  emptyKind?: SenderTableEmptyKind | undefined;
  /** Density preference — `compact` halves the row padding. */
  density?: 'comfortable' | 'compact' | undefined;
}

/** Sortable header column descriptors — keeps column count stable. */
const COLUMNS: ReadonlyArray<{
  key: SenderListSort | null;
  label: string;
  alignRight?: boolean;
  aria?: string;
}> = [
  { key: null, label: '' }, // checkbox
  { key: 'name', label: 'Sender' },
  { key: 'total', label: 'Total', alignRight: true },
  { key: null, label: 'Trend' },
  { key: null, label: 'Read' },
  { key: 'last_seen', label: 'Last seen', alignRight: true },
  { key: null, label: 'Unsub' },
  { key: null, label: '' }, // verbs
  { key: null, label: '' }, // expand chevron
];

const ROW_PAD_COMFORTABLE = '10px 12px';
const ROW_PAD_COMPACT = '6px 12px';

export function SenderTable(props: SenderTableProps) {
  const { rows, loading, error } = props;
  const pad = props.density === 'compact' ? ROW_PAD_COMPACT : ROW_PAD_COMFORTABLE;

  return (
    <div
      data-dm-component="sender-table"
      style={{
        background: color.card,
        borderRadius: radius.lg,
        border: `1px solid ${color.line}`,
        overflow: 'hidden',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: font.sans,
          fontSize: text.base,
          color: color.fg,
        }}
      >
        <thead
          style={{
            background: color.bg,
            position: 'sticky',
            top: 0,
            zIndex: 1,
          }}
        >
          <tr>
            {COLUMNS.map((col, idx) => (
              <SortHeader
                key={`${col.label}-${idx}`}
                col={col}
                activeSort={props.sort}
                activeDirection={props.direction}
                onSortChange={props.onSortChange}
                pad={pad}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows pad={pad} />
          ) : error ? (
            <ErrorRow error={error} onRetry={props.onRetry} />
          ) : rows.length === 0 ? (
            <EmptyRow kind={props.emptyKind ?? 'no-senders'} />
          ) : (
            rows.map((sender) => (
              <SenderRow
                key={sender.id}
                sender={sender}
                globalMaxTotal={props.globalMaxTotal}
                selected={props.selectedIds.has(sender.id)}
                onSelectionChange={(checked) =>
                  toggleSelection(props.selectedIds, sender.id, checked, props.onSelectionChange)
                }
                onAction={props.onAction}
                pad={pad}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Sortable column header. `aria-sort` reflects the active state — the
 * single piece of metadata assistive tech reads to announce "sorted by
 * Total, descending". Non-sortable columns render their label as plain
 * `<th>` text.
 */
function SortHeader({
  col,
  activeSort,
  activeDirection,
  onSortChange,
  pad,
}: {
  col: (typeof COLUMNS)[number];
  activeSort: SenderListSort;
  activeDirection: SenderListDirection;
  onSortChange: SenderTableProps['onSortChange'];
  pad: string;
}) {
  const isActive = col.key !== null && col.key === activeSort;
  const ariaSort: 'ascending' | 'descending' | 'none' = isActive
    ? activeDirection === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none';

  const baseStyle: CSSProperties = {
    textAlign: col.alignRight ? 'right' : 'left',
    padding: pad,
    fontFamily: font.mono,
    fontSize: text.xs,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: color.fgMuted,
    borderBottom: `1px solid ${color.line}`,
  };

  if (col.key === null) {
    return <th scope="col" style={baseStyle} />;
  }
  return (
    <th scope="col" aria-sort={ariaSort} style={baseStyle}>
      <button
        type="button"
        onClick={() =>
          onSortChange(nextSortFor(col.key as SenderListSort, isActive, activeDirection))
        }
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          color: isActive ? color.fg : color.fgMuted,
          fontFamily: 'inherit',
          fontSize: 'inherit',
          fontWeight: 'inherit',
          letterSpacing: 'inherit',
          textTransform: 'inherit',
        }}
      >
        <span>{col.label}</span>
        {isActive ? (
          <span aria-hidden="true" style={{ fontSize: 10 }}>
            {activeDirection === 'asc' ? '↑' : '↓'}
          </span>
        ) : null}
      </button>
    </th>
  );
}

/**
 * Pure — pick the next `(sort, direction)` for a header click. Toggle
 * direction when the clicked column is already active; otherwise set
 * to the sane default direction for that column. Exported only via
 * tests; not part of the component's public surface.
 */
function nextSortFor(
  clicked: SenderListSort,
  isActive: boolean,
  activeDirection: SenderListDirection,
): { sort: SenderListSort; direction: SenderListDirection } {
  if (isActive) {
    return { sort: clicked, direction: activeDirection === 'asc' ? 'desc' : 'asc' };
  }
  return { sort: clicked, direction: DEFAULT_DIRECTION_BY_SORT[clicked] };
}

/** Mirrors the BE's `DEFAULT_DIRECTION_BY_SORT` so the FE stays consistent. */
const DEFAULT_DIRECTION_BY_SORT: Record<SenderListSort, SenderListDirection> = {
  total: 'desc',
  last_seen: 'desc',
  first_seen: 'desc',
  name: 'asc',
  read: 'desc',
  recommended: 'desc',
};

/**
 * Pure helper — toggle a sender id in the selection set without mutating
 * the input. Lifted so the table's selection semantics are testable in
 * isolation from the React render path.
 */
function toggleSelection(
  prev: ReadonlySet<string>,
  id: string,
  checked: boolean,
  emit: (next: ReadonlySet<string>) => void,
): void {
  const next = new Set(prev);
  if (checked) next.add(id);
  else next.delete(id);
  emit(next);
}

/** One sender row — the workhorse cell composition. */
function SenderRow({
  sender,
  globalMaxTotal,
  selected,
  onSelectionChange,
  onAction,
  pad,
}: {
  sender: SenderListRow;
  globalMaxTotal: number;
  selected: boolean;
  onSelectionChange(checked: boolean): void;
  onAction: SenderTableProps['onAction'];
  pad: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const cellStyle: CSSProperties = {
    padding: pad,
    borderBottom: `1px solid ${color.lineSoft}`,
    verticalAlign: 'middle',
  };

  return (
    <>
      <tr data-dm-sender-id={sender.id} data-dm-selected={selected || undefined}>
        <td style={{ ...cellStyle, width: 28 }}>
          <input
            type="checkbox"
            aria-label={`Select ${displayLabel(sender)}`}
            checked={selected}
            onChange={(e) => onSelectionChange(e.target.checked)}
          />
        </td>

        <td style={{ ...cellStyle, maxWidth: 320 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {displayLabel(sender)}
            </span>
            <span style={{ color: color.fgMuted, fontSize: text.sm }}>{sender.domain}</span>
          </div>
        </td>

        <td style={{ ...cellStyle, textAlign: 'right', width: 180 }}>
          <TotalCell value={sender.totalReceived} max={globalMaxTotal} />
        </td>

        <td style={{ ...cellStyle, width: 90 }}>
          <TrendChip bucket={sender.volumeTrend} />
        </td>

        <td style={{ ...cellStyle, width: 90 }}>
          <ReadCell rate={sender.readRate} />
        </td>

        <td
          style={{
            ...cellStyle,
            textAlign: 'right',
            width: 110,
            color: color.fgMuted,
            fontFamily: font.mono,
            fontSize: text.sm,
          }}
        >
          {relativeDate(sender.lastSeenAt)}
        </td>

        <td style={{ ...cellStyle, width: 70 }}>
          <UnsubGlyph method={sender.unsubscribeMethod} />
        </td>

        <td style={{ ...cellStyle, width: 280 }}>
          <VerbButtons sender={sender} onAction={onAction} />
        </td>

        <td style={{ ...cellStyle, width: 32 }}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={
              expanded ? `Collapse ${displayLabel(sender)}` : `Expand ${displayLabel(sender)}`
            }
            onClick={() => setExpanded((v) => !v)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              borderRadius: radius.sm,
              color: color.fgMuted,
            }}
          >
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          </button>
        </td>
      </tr>
      {expanded ? <ExpandedRow sender={sender} /> : null}
    </>
  );
}

/** Total + magnitude bar — bar suppressed when `max === 0`. */
function TotalCell({ value, max }: { value: number; max: number }) {
  // Defense in depth: a malformed wire payload that drops
  // `totalReceived` would otherwise crash `toLocaleString()`. ADR-0014
  // guarantees this is a JS number on the wire; we coerce here so a
  // regression surfaces as a "0" cell rather than a render crash that
  // takes the whole table down.
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const safeMax = max > 0 ? max : 1;
  const pct = Math.min(100, Math.round((safeValue / safeMax) * 100));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <span
        style={{
          fontFamily: font.mono,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 600,
        }}
      >
        {safeValue.toLocaleString()}
      </span>
      {max > 0 ? (
        <span
          aria-hidden="true"
          style={{
            display: 'block',
            width: 120,
            height: 4,
            borderRadius: radius.pill,
            background: color.mutedBg,
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              display: 'block',
              width: `${pct}%`,
              height: '100%',
              background: color.primary,
            }}
          />
        </span>
      ) : null}
    </div>
  );
}

const TREND_LABEL: Record<VolumeTrendBucket, string> = {
  up: '↑ Up',
  down: '↓ Down',
  steady: '— Steady',
  dormant: '○ Dormant',
  new: '• New',
};

const TREND_COLOR: Record<VolumeTrendBucket, string> = {
  up: color.amber,
  down: color.emerald,
  steady: color.fgMuted,
  dormant: color.fgMuted,
  new: color.primary,
};

function TrendChip({ bucket }: { bucket: VolumeTrendBucket | null }) {
  if (bucket === null) {
    return (
      <span aria-label="No trend data" style={{ color: color.fgMuted }}>
        —
      </span>
    );
  }
  return (
    <span
      aria-label={`Trend: ${TREND_LABEL[bucket]}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: radius.pill,
        background: color.mutedBg,
        color: TREND_COLOR[bucket],
        fontFamily: font.mono,
        fontSize: text.xs,
        fontWeight: 600,
      }}
    >
      {TREND_LABEL[bucket]}
    </span>
  );
}

/**
 * Read-rate as a discrete bucket label, never a raw percentage.
 * Buckets follow the existing tightening-brief vocabulary:
 *   - null         — "—"     (no timeseries yet)
 *   - 0            — "Never" (red pill)
 *   - 0 < r < 0.30 — "Low"   (amber)
 *   - 0.30..0.70   — "Mid"   (neutral)
 *   - 0.70..1.00   — "High"  (emerald)
 * Raw percentages are deliberately omitted — false precision on small
 * baselines (Codex review on the senders-tightening brief).
 */
function ReadCell({ rate }: { rate: number | null }) {
  if (rate === null) return <span style={{ color: color.fgMuted }}>—</span>;
  if (rate === 0) {
    return (
      <span
        aria-label="Read rate: never marked read"
        style={{
          display: 'inline-flex',
          padding: '1px 6px',
          borderRadius: radius.pill,
          background: color.redBg,
          color: color.red,
          fontFamily: font.mono,
          fontSize: text.xs,
          fontWeight: 700,
        }}
      >
        Never
      </span>
    );
  }
  const label = rate < 0.3 ? 'Low' : rate < 0.7 ? 'Mid' : 'High';
  const c = rate < 0.3 ? color.amber : rate < 0.7 ? color.fgMuted : color.emerald;
  return (
    <span
      aria-label={`Read rate: ${label}`}
      style={{
        fontFamily: font.mono,
        fontSize: text.sm,
        fontWeight: 600,
        color: c,
      }}
    >
      {label}
    </span>
  );
}

const UNSUB_GLYPH: Record<UnsubscribeMethod, { glyph: string; label: string }> = {
  one_click: { glyph: '✓', label: 'One-click unsubscribe available' },
  mailto: { glyph: '✉', label: 'Email-based unsubscribe' },
  none: { glyph: '—', label: 'No unsubscribe header' },
};

function UnsubGlyph({ method }: { method: UnsubscribeMethod | null }) {
  if (method === null) {
    return (
      <span aria-label="No unsubscribe data" style={{ color: color.fgMuted }}>
        —
      </span>
    );
  }
  const { glyph, label } = UNSUB_GLYPH[method];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ color: color.fgMuted, fontSize: text.md }}
    >
      {glyph}
    </span>
  );
}

/**
 * Row verbs in canonical K/A/U/L order (D227). The label + shortcut are
 * read from the Action Registry (ADR-0015) at render time, not hardcoded
 * here — one registry descriptor is the source of truth shared with the
 * SelectionBar, the confirm modal, and the keyboard cheatsheet.
 */
const VERB_ORDER: readonly SenderTableVerb[] = ['keep', 'archive', 'unsubscribe', 'later'];

function VerbButtons({
  sender,
  onAction,
}: {
  sender: SenderListRow;
  onAction: SenderTableProps['onAction'];
}) {
  return (
    <div style={{ display: 'inline-flex', gap: 4 }}>
      {VERB_ORDER.map((verb) => {
        const { copy, shortcut } = getActionDescriptor(verb);
        const label = copy.primary;
        return (
          <button
            key={verb}
            type="button"
            onClick={(e) => {
              // Defense in depth — stop the click bubbling to any future
              // row-level handler. Today there is none; this keeps a
              // future regression caller from accidentally double-firing.
              e.stopPropagation();
              onAction({ verb, sender });
            }}
            aria-label={`${label} ${displayLabel(sender)}`}
            title={shortcut ? `${label} (${shortcut})` : label}
            style={{
              all: 'unset',
              cursor: 'pointer',
              padding: '4px 10px',
              borderRadius: radius.sm,
              border: `1px solid ${color.line}`,
              background: color.card,
              fontFamily: font.sans,
              fontSize: text.sm,
              fontWeight: 500,
              color: color.fg,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Expand row — slot for the future Sender Detail mini-card. */
function ExpandedRow({ sender }: { sender: SenderListRow }) {
  return (
    <tr data-dm-expanded-for={sender.id}>
      <td colSpan={COLUMNS.length} style={{ padding: '12px 12px 16px 48px', background: color.bg }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            color: color.fgMuted,
            fontSize: text.sm,
          }}
        >
          <div>
            <span style={{ fontWeight: 600, color: color.fg }}>{displayLabel(sender)}</span>
            {' · '}
            <span>{sender.email}</span>
          </div>
          <div>
            First seen: {formatDate(sender.firstSeenAt)} · Last seen:{' '}
            {formatDate(sender.lastSeenAt)}
          </div>
          {sender.lastReview ? (
            <div>
              Last review: {sender.lastReview.verdict}
              {sender.lastReview.confidence !== undefined
                ? ` (${Math.round(sender.lastReview.confidence * 100)}%)`
                : ''}
              {' · '}
              {formatDate(sender.lastReview.at)}
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/**
 * Skeleton rows — render 6 placeholder rows with the SAME `<td>` count
 * as a real row. The column header set is unchanged so a sort/filter
 * refetch never reflows the column geometry (no horizontal jump).
 */
function SkeletonRows({ pad }: { pad: string }) {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} data-dm-sender-skeleton aria-hidden="true">
          {COLUMNS.map((_, c) => (
            <td key={c} style={{ padding: pad, borderBottom: `1px solid ${color.lineSoft}` }}>
              <span
                style={{
                  display: 'block',
                  height: 12,
                  borderRadius: radius.sm,
                  background: color.mutedBg,
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function ErrorRow({
  error,
  onRetry,
}: {
  error: { message: string };
  onRetry: SenderTableProps['onRetry'];
}) {
  return (
    <tr>
      <td
        colSpan={COLUMNS.length}
        style={{
          padding: '32px 16px',
          textAlign: 'center',
          background: color.redBg,
          color: color.red,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <span>Failed to load senders. {error.message}</span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              style={{
                all: 'unset',
                cursor: 'pointer',
                padding: '6px 14px',
                borderRadius: radius.sm,
                background: color.card,
                color: color.fg,
                border: `1px solid ${color.line}`,
                fontFamily: font.sans,
                fontSize: text.sm,
                fontWeight: 500,
              }}
            >
              Retry
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

const EMPTY_COPY: Record<SenderTableEmptyKind, { headline: string; sub: string }> = {
  'no-senders': {
    headline: 'No senders yet',
    sub: 'Your mailbox is syncing — senders appear here once the index builds.',
  },
  'no-filter-match': {
    headline: 'No senders match this filter',
    sub: 'Try removing a filter or switching to a different category.',
  },
  'no-search-match': {
    headline: 'No matches',
    sub: 'No senders match your search. Check spelling or shorten the query.',
  },
};

function EmptyRow({ kind }: { kind: SenderTableEmptyKind }) {
  const copy = EMPTY_COPY[kind];
  return (
    <tr>
      <td
        colSpan={COLUMNS.length}
        style={{
          padding: '48px 16px',
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, color: color.fgMuted }}>
          <span style={{ fontSize: text.lg, fontWeight: 600, color: color.fg }}>
            {copy.headline}
          </span>
          <span>{copy.sub}</span>
        </div>
      </td>
    </tr>
  );
}

/** Sender display label — falls back to email when the From-header name is empty. */
function displayLabel(sender: SenderListRow): string {
  return sender.displayName.trim() === '' ? sender.email : sender.displayName;
}

/** ISO-8601 → relative-date short string. Future BE-side helper candidate. */
function relativeDate(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Math.max(0, now - then);
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diff / day);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

/** Re-exported for tests. */
export const __internals = { nextSortFor, toggleSelection, displayLabel, relativeDate };
