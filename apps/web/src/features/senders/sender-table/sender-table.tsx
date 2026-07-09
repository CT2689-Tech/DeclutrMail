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
 *    is the dedicated ACCESSIBLE expand control (`aria-expanded`).
 *    Checkbox, verbs, and the chevron are siblings — never nested
 *    interactives. The row body additionally accepts a plain pointer
 *    click as an expand convenience (2026-07-07 founder smoke feedback:
 *    match Triage's whole-row affordance) — but it carries NO role, NO
 *    tabindex, and clicks originating on interactive descendants are
 *    ignored, so the a11y tree still sees a single landmark per cell
 *    and keyboard/screen-reader flows are unchanged.
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

import type { CSSProperties, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { Avatar, NumericDisplay, tokens } from '@declutrmail/shared';
import { SenderActionRow } from '../action-row';
import { adaptSenderListRow } from '../api/adapters';
import { EPOCH_GUARD_DAYS } from '../data';
import type { ActionVerb, Sender } from '../data';
import { ReadBucketText, TrendChip } from '../fact-language';
import { UNSUB_PILL } from '../grid/sender-card';
import { SenderRowDetailLive } from '../table/sender-row-detail';
import { intentOf, type SenderIntent } from '../uplift-d/intent';

import type {
  SenderListDirection,
  SenderListRow,
  SenderListSort,
  UnsubscribeMethod,
} from '@/lib/api/senders';

const { color, font, radius, text } = tokens;

/** Discriminator for the empty-state cell when `rows.length === 0`. */
export type SenderTableEmptyKind = 'no-senders' | 'no-filter-match' | 'no-search-match';

/**
 * Row-level verb the table emits up to the consumer.
 * Spec v1.2 Decision 1 (ADR-0019) widens the canonical set to K/A/U/L/D —
 * Delete joins as a row verb so the popover row + bulk surface route the
 * same shape end-to-end. `keep` joined with the 2026-07-03 consistency
 * pass: the row now renders the shared `SenderActionRow` (primary verb +
 * ⋯ ActionPopover — ADR-0016 A5), and the popover's registry set is
 * K/A/U/L/D on every surface. Keep is non-destructive so the consumer
 * routes it straight to `performAction` (D40), no preview.
 */
export type SenderTableVerb = 'keep' | 'archive' | 'later' | 'unsubscribe' | 'delete';

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
   * Per-row checkbox toggle with the modifier state (D52 shift-click
   * ranges). When provided, the CALLER owns the selection-set math
   * (anchor + range) and `onSelectionChange` is not called for row
   * clicks; when absent, the table falls back to its internal
   * single-row toggle.
   */
  onRowToggle?(args: { id: string; checked: boolean; shiftKey: boolean }): void;
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
  // Monthly cadence — the number the grid card leads with. Present on
  // both views so the Grid↔Table toggle never drops a fact (2026-07-03
  // consistency pass). Not sortable: the wire `SenderListSort` union
  // has no volume axis yet.
  { key: null, label: 'Monthly', alignRight: true },
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
                onSelectionChange={(checked, shiftKey) =>
                  props.onRowToggle
                    ? props.onRowToggle({ id: sender.id, checked, shiftKey })
                    : toggleSelection(
                        props.selectedIds,
                        sender.id,
                        checked,
                        props.onSelectionChange,
                      )
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
    // Non-sortable columns still render their label — this branch used
    // to drop it, leaving Trend / Read / Unsub (and now Monthly) with
    // blank headers.
    return (
      <th scope="col" style={baseStyle}>
        {col.label}
      </th>
    );
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
  onSelectionChange(checked: boolean, shiftKey: boolean): void;
  onAction: SenderTableProps['onAction'];
  pad: string;
}) {
  const [expanded, setExpanded] = useState(false);

  // Intent tone — drives the left-edge tone stripe + magnitude-bar
  // accent so the table row visually rhymes with the grid SenderCard
  // and the Hero Bloc cards. Same predicate (`intentOf`) feeds the
  // chip count, so row tone and chip count cannot disagree.
  const adapted = useMemo(() => adaptSenderListRow(sender), [sender]);
  const intent = intentOf(adapted);
  const toneAccent = ROW_TONE_ACCENT[intent];

  const cellStyle: CSSProperties = {
    padding: pad,
    borderBottom: `1px solid ${color.lineSoft}`,
    verticalAlign: 'middle',
  };

  return (
    <>
      <tr
        data-dm-sender-id={sender.id}
        data-dm-selected={selected || undefined}
        onClick={(e) => {
          // Pointer-only convenience — never steal clicks meant for the
          // checkbox / verbs / popover / chevron (or anything focusable
          // that lands in a cell later). The chevron stays the sole
          // accessible expand control; see architecture note 2.
          const target = e.target as HTMLElement;
          if (target.closest('button, a, input, select, textarea, label, [role="button"]')) {
            return;
          }
          setExpanded((v) => !v);
        }}
        style={{ cursor: 'pointer' }}
      >
        <td
          style={{
            ...cellStyle,
            width: 28,
            position: 'relative',
            paddingLeft: pad,
          }}
        >
          {/* Tone stripe — 3px left edge, intent-colored. Subtle but
              makes every row instantly readable by bucket. */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 3,
              background: toneAccent,
            }}
          />
          {/* Toggle fires from onClick (not onChange) — only the click
              event carries `shiftKey`, which the screen's range-select
              logic consumes (D52). Controlled `checked` + `readOnly`
              keeps React's controlled-input contract; Space still
              toggles (the browser synthesizes a click). */}
          <input
            type="checkbox"
            aria-label={`Select ${displayLabel(sender)}`}
            checked={selected}
            readOnly
            onClick={(e) => onSelectionChange(!selected, e.shiftKey)}
          />
        </td>

        <td style={{ ...cellStyle, maxWidth: 320 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {/* Identity anchor (ADR-0024) — the same monogram the grid
                card and detail header render, so the Grid↔Table toggle
                keeps the sender's visual identity. */}
            <Avatar name={displayLabel(sender)} domain={sender.domain} size={22} />
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 0,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                <ProtectStar flags={sender.protectionFlags} />
                <span
                  // Full identity on hover — duplicate display names
                  // ("Amazon.com" ×5) are only distinguishable by the
                  // underlying address, which the row otherwise never
                  // renders (2026-07-07 founder smoke feedback).
                  title={`${displayLabel(sender)} <${sender.email}>`}
                  style={{
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    letterSpacing: '-0.005em',
                  }}
                >
                  {displayLabel(sender)}
                </span>
                {/* Unsub status chip (D9 Wave 2) — same trigger + copy map
                  as the grid card so list ↔ grid never contradict:
                  shown while a standing unsubscribe policy exists,
                  copy keyed by the execution outcome. */}
                {sender.policyType === 'unsubscribe' && (
                  <span
                    title={UNSUB_PILL[sender.unsubStatus ?? 'none'].title}
                    style={{
                      fontFamily: font.mono,
                      fontSize: 9.5,
                      letterSpacing: '0.10em',
                      textTransform: 'uppercase',
                      color: color.primary,
                      background: color.primarySoft,
                      border: `1px solid ${color.primaryBorder}`,
                      borderRadius: 999,
                      padding: '1px 6px',
                      flex: '0 0 auto',
                    }}
                  >
                    {UNSUB_PILL[sender.unsubStatus ?? 'none'].label}
                  </span>
                )}
              </span>
              <span
                style={{
                  color: color.fgMuted,
                  fontSize: text.sm,
                  fontFamily: font.mono,
                  letterSpacing: '0.005em',
                }}
              >
                {sender.domain}
              </span>
            </div>
          </div>
        </td>

        <td style={{ ...cellStyle, textAlign: 'right', width: 180 }}>
          <TotalCell value={sender.totalReceived} max={globalMaxTotal} accent={toneAccent} />
        </td>

        <td
          style={{
            ...cellStyle,
            textAlign: 'right',
            width: 90,
            fontFamily: font.mono,
            fontSize: text.sm,
            fontVariantNumeric: 'tabular-nums',
            color: color.fgSoft,
          }}
        >
          {/* Monthly cadence — same fact the card leads with ("N in last
              30d"). Nullable when the sender has no timeseries rows. */}
          {sender.monthlyVolume != null ? `${sender.monthlyVolume.toLocaleString()}/mo` : '—'}
        </td>

        <td style={{ ...cellStyle, width: 90 }}>
          <TrendChip bucket={sender.volumeTrend} />
        </td>

        <td style={{ ...cellStyle, width: 90 }}>
          <ReadBucketText rate={sender.readRate} />
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

        <td style={{ ...cellStyle, width: 170 }}>
          {/* Shared action grammar (ADR-0016 A5 + ADR-0019): derived
              primary verb + ⋯ ActionPopover — the same `SenderActionRow`
              the grid card renders, replacing the three hardcoded inline
              buttons. `adapted` is the FE `Sender` shape the shared row
              reads; verbs bridge back to the table's lowercase union. */}
          <SenderActionRow
            sender={adapted}
            onAction={(req) => {
              const mapped = ROW_VERB_TO_TABLE[req.verb];
              if (mapped === null) return;
              onAction({ verb: mapped, sender });
            }}
          />
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
      {expanded ? <ExpandedRow sender={sender} onAction={onAction} /> : null}
    </>
  );
}

/** Total + magnitude bar — bar suppressed when `max === 0`. */
function TotalCell({ value, max, accent }: { value: number; max: number; accent?: string }) {
  // Defense in depth: a malformed wire payload that drops
  // `totalReceived` would otherwise crash `toLocaleString()`. ADR-0014
  // guarantees this is a JS number on the wire; we coerce here so a
  // regression surfaces as a "0" cell rather than a render crash that
  // takes the whole table down.
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const safeMax = max > 0 ? max : 1;
  const pct = Math.min(100, Math.round((safeValue / safeMax) * 100));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      {/* ADR-0016 §A1 — total cell uses `NumericDisplay
          variant="display"` (Fraunces 28/400/-0.025em) so the row
          total scale matches the SenderDetailHeader h1 + Hero slice
          headline. Was ad-hoc 18px/600. */}
      <NumericDisplay value={safeValue.toLocaleString()} variant="display" />
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
              background: accent ?? color.primary,
            }}
          />
        </span>
      ) : null}
    </div>
  );
}

/**
 * Per-row tone-stripe accent — same intent-to-tone mapping the grid
 * `SenderCard` and Hero `Bloc` use. Cleanup = amber, Protect = primary,
 * Later = subtle neutral, People = transparent (no stripe).
 */
const ROW_TONE_ACCENT: Record<SenderIntent, string> = {
  cleanup: color.amber,
  later: color.fgMuted,
  protect: color.primary,
  people: 'transparent',
};

// Trend + read-state rendering moved to `../fact-language.tsx`
// (2026-07-03 consistency pass) — the table, the grid card stat strip,
// and the detail stats strip previously each carried their own copy
// with CONFLICTING tones (`up` was amber here but primary on the
// detail strip; `down` used emerald — the A3 trust hue). One module,
// one vocabulary.

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
 * Bridge — the shared `SenderActionRow` + `SenderRowDetail` emit
 * canonical-cased verbs ('Archive' / 'Keep' / …); the table's public
 * `onAction` speaks the lowercase `SenderTableVerb` union. Keep routes
 * through (non-destructive, consumer applies immediately per D40);
 * Protect stays a status star (D42/D43), never a row verb.
 */
const ROW_VERB_TO_TABLE: Record<ActionVerb, SenderTableVerb | null> = {
  Keep: 'keep',
  Archive: 'archive',
  Unsubscribe: 'unsubscribe',
  Later: 'later',
  Delete: 'delete',
  Protect: null,
};

/**
 * Read-only standing-protection indicator (D42/D43). Protect is a *status*,
 * not a triage verb (D227), so it renders as a ⭐ on protected / VIP rows —
 * never a verb button. It is intentionally non-interactive here BY DESIGN:
 * the Protect write endpoint exists (`PATCH /api/senders/:id/policy` via
 * `useSetSenderPolicy`), but toggling a standing policy is a deliberate
 * per-sender decision that lives on the Sender Detail page — a one-click
 * row star invites accidental flips mid-scan. Renders nothing for
 * unprotected rows so the name column stays quiet.
 */
function ProtectStar({ flags }: { flags: SenderListRow['protectionFlags'] }) {
  if (!flags.isVip && !flags.isProtected) return null;
  const label = flags.isVip ? 'VIP — protected' : 'Protected';
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ color: color.amber, fontSize: text.sm, flexShrink: 0, lineHeight: 1 }}
    >
      ★
    </span>
  );
}

/**
 * Expand row — rich SenderRowDetail panel (#146 restoration).
 *
 * Pre-ce00ad1, the grid-table expand showed a recommendation callout +
 * sparkline + sample subjects + verb buttons. The Slice 1 flat-sortable
 * table shipped with a stub (3 metadata lines) by accident. This wires
 * the existing rich `SenderRowDetail` component back in. Adapts the
 * wire `SenderListRow` to the FE `Sender` shape via the same adapter
 * the grid view uses, so the two surfaces stay visually consistent.
 *
 * `onAction` threads the parent's D226 preview path so the inline
 * verbs from the expand panel route through the same mandatory
 * action-preview as the row's main verb buttons.
 */
function ExpandedRow({
  sender,
  onAction,
}: {
  sender: SenderListRow;
  onAction: SenderTableProps['onAction'];
}) {
  // Adapt the wire row to the FE `Sender` shape SenderRowDetail expects.
  // Memoised on the row id since adaptation is identity-stable per row.
  const adapted = useMemo(() => adaptSenderListRow(sender), [sender]);
  // Bridge — SenderRowDetail emits canonical-cased verbs; the parent's
  // `onAction` expects lowercase `SenderTableVerb`. Shared module-scope
  // map (also used by the row's SenderActionRow) — Keep now routes
  // instead of silently no-op'ing (pre-2026-07-03 the panel's Keep
  // button mapped to null and dropped the click on the floor).
  const bridgedAction = (req: { verb: ActionVerb; senders: Sender[] }) => {
    const mapped = ROW_VERB_TO_TABLE[req.verb];
    if (mapped === null) return;
    onAction({ verb: mapped, sender });
  };
  return (
    <tr data-dm-expanded-for={sender.id}>
      <td colSpan={COLUMNS.length} style={{ padding: '12px 12px 16px 48px', background: color.bg }}>
        <SenderRowDetailLive s={adapted} onAction={bridgedAction} />
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

const EMPTY_COPY: Record<SenderTableEmptyKind, { headline: string; sub: ReactNode }> = {
  'no-senders': {
    headline: 'No senders yet',
    sub: (
      <>
        Your mailbox is syncing — senders appear here once the index builds.{' '}
        <a href="/help#getting-started">How to get started →</a>
      </>
    ),
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
  // Epoch guard — Gmail reports internalDate=0 for some spam, which
  // otherwise renders as "56y ago". Same threshold as data.ts relTime.
  if (days > EPOCH_GUARD_DAYS) return '—';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Re-exported for tests. */
export const __internals = { nextSortFor, toggleSelection, displayLabel, relativeDate };
