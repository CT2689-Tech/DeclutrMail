'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Avatar, Button, EmptyState, ScreenIntro, tokens } from '@declutrmail/shared';

import { ApiError } from '@/lib/api/client';
import type {
  ActivityActionWire,
  ActivityFilters,
  ActivityRowWire,
  ActivitySourceFilterWire,
  ActivityStatsWire,
  ActivityVerbFilterWire,
  ActivityWindowWire,
} from '@/lib/api/activity';

import { useActivity, useRevertActivity } from './api/use-activity';

const { color, font } = tokens;

/**
 * Activity screen (D55-D60 + B-track power-options).
 *
 * Layout (top → bottom):
 *   1. ScreenIntro
 *   2. Stats — D59 window stats + B16 all-time totals (separate line)
 *   3. Source chips (D56)
 *   4. Verb chips (B8 — Archived / Deleted / Unsub / Later / Kept)
 *   5. Window picker (D55) + Custom date range (B10)
 *   6. Sender search (B9) + Group-by-sender toggle (B11) + Export CSV (B14)
 *   7. Bulk action bar (B7 — only visible when ≥1 row selected)
 *   8. Row list — flat (D57) OR sender-grouped (B11)
 *
 * D58 undo affordance is fully wired (B7 + B13):
 *   - per-row Undo button POSTs `/api/undo/:token` and the row's
 *     `undoState` flips to `executed` on the next refetch.
 *   - on revert error, the row carries a "Try again" affordance.
 *   - bulk Undo (B7) fans the same mutation across every selected
 *     `available` row in parallel.
 *
 * URL is the SINGLE source of truth for filter + grouping state — every
 * filter writes back via `router.replace` so deep links round-trip.
 *
 * Cache effect on mailbox switch: query keys are partitioned by full
 * filter set but NOT mailbox; relies on `resetMailboxScopedCache`
 * (CLAUDE.md §8 invariant — the `activityKeys.all` prefix is named).
 *
 * Privacy (D7, D228): sender identity, action verb, count, timestamp,
 * undo token only. No body, no snippet, no headers.
 */
export function ActivityScreen() {
  const router = useRouter();
  const params = useSearchParams();

  const filters = readFiltersFromUrl(params);
  const groupMode = readGroupMode(params.get('group'));

  const query = useActivity(filters);

  const writeUrl = useCallback(
    (updates: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === '') sp.delete(k);
        else sp.set(k, v);
      }
      router.replace(`/activity${sp.toString() ? `?${sp.toString()}` : ''}`);
    },
    [params, router],
  );

  const setWindow = useCallback(
    (next: ActivityWindowWire) => {
      // Picking a window preset clears the custom date range so the
      // two affordances don't fight; the BE prioritises date range
      // when both are set, but the UI should reflect a single choice.
      writeUrl({ window: next, date_from: null, date_to: null });
    },
    [writeUrl],
  );
  const setSource = useCallback(
    (next: ActivitySourceFilterWire) => {
      writeUrl({ source: next === 'all' ? null : next });
    },
    [writeUrl],
  );
  const setVerbs = useCallback(
    (next: readonly ActivityVerbFilterWire[]) => {
      writeUrl({ verb: next.length === 0 ? null : next.join(',') });
    },
    [writeUrl],
  );
  const setSenderQuery = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      writeUrl({ sender_q: trimmed.length === 0 ? null : trimmed });
    },
    [writeUrl],
  );
  const setDateRange = useCallback(
    (from: string | null, to: string | null) => {
      writeUrl({ date_from: from, date_to: to });
    },
    [writeUrl],
  );
  const setGroupMode = useCallback(
    (next: GroupMode) => {
      writeUrl({ group: next === 'none' ? null : next });
    },
    [writeUrl],
  );

  // ── Multi-select state (local, NOT URL-persisted) ──────────────────
  // Selection lives in component state because:
  //   - selections rarely outlive a tab (close = drop)
  //   - URL-encoding 100+ ids per page would blow the URL limit
  //   - filter changes naturally drop selections (we clear below)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const filterKey = useMemo(
    () =>
      JSON.stringify([
        filters.window,
        filters.source,
        filters.verbs,
        filters.senderQuery,
        filters.dateFrom,
        filters.dateTo,
      ]),
    [
      filters.window,
      filters.source,
      filters.verbs,
      filters.senderQuery,
      filters.dateFrom,
      filters.dateTo,
    ],
  );
  useEffect(() => {
    // Filter change → drop selections. Otherwise a row hidden by a new
    // filter could still be in the bulk action set, invisible.
    setSelectedIds(new Set());
  }, [filterKey]);
  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (query.isLoading) return <LoadingState />;
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }

  const env = query.data!;
  const rows = env.data;
  const meta = env.meta;
  const stats = meta?.stats;
  const allTimeStats = meta?.allTimeStats;

  return (
    <div
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        maxWidth: 980,
        fontFamily: font.sans,
      }}
    >
      <ScreenIntro
        id="activity"
        title="Activity"
        body="Every decision taken on your mail — by you, by Autopilot, by your rules. Filter by source, verb, sender, or date. Undo windows: Archive/Later 7 days, Delete 30 days (Gmail Trash)."
        tip="An empty list within a short window is fine — it means nothing changed. Widen the window to see history."
      />

      {stats && (
        <StatsLine
          label={windowToLabel(
            filters.window ?? '30d',
            filters.dateFrom ?? null,
            filters.dateTo ?? null,
          )}
          stats={stats}
        />
      )}
      {allTimeStats && <StatsLine label="all time" stats={allTimeStats} tone="muted" />}

      <SourceChips active={filters.source ?? 'all'} onSelect={setSource} />
      <VerbChips active={filters.verbs ?? []} onChange={setVerbs} />
      <WindowAndDateRow
        window={filters.window ?? '30d'}
        dateFrom={filters.dateFrom ?? null}
        dateTo={filters.dateTo ?? null}
        onWindow={setWindow}
        onRange={setDateRange}
      />
      <ToolsRow
        senderQuery={filters.senderQuery ?? ''}
        onSenderQuery={setSenderQuery}
        groupMode={groupMode}
        onGroupMode={setGroupMode}
        rows={rows}
        filters={filters}
      />

      <BulkActionBar
        rows={rows}
        selectedIds={selectedIds}
        onClear={() => setSelectedIds(new Set())}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No activity in this window."
          description={
            <>
              Try widening the time range, clearing the verb / sender filter, or switching the
              source — the activity log is append-only, so nothing has been removed.
            </>
          }
        />
      ) : groupMode === 'sender' ? (
        <GroupedList rows={rows} selectedIds={selectedIds} onToggle={toggleRow} />
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
            <ActivityRow
              key={row.id}
              row={row}
              isSelected={selectedIds.has(row.id)}
              onToggleSelect={() => toggleRow(row.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Stats line ────────────────────────────────────────────────────────

function StatsLine({
  label,
  stats,
  tone = 'fg',
}: {
  label: string;
  stats: ActivityStatsWire;
  tone?: 'fg' | 'muted';
}) {
  const labelColor = tone === 'muted' ? color.fgMuted : color.fg;
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
      <strong style={{ color: labelColor, fontWeight: 600, textTransform: 'lowercase' }}>
        {label}:
      </strong>
      <span>{stats.archived} archived</span>
      <Sep />
      <span>{stats.deleted ?? 0} deleted</span>
      <Sep />
      <span>{stats.unsubscribed} unsubscribed</span>
      <Sep />
      <span>{stats.kept} kept</span>
      <Sep />
      <span>{stats.later} later</span>
      {tone === 'fg' && (
        <>
          <Sep />
          <span>{stats.needsAttention} needing attention</span>
        </>
      )}
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

// ── Verb chips (B8) ───────────────────────────────────────────────────

const VERB_CHIPS: ReadonlyArray<{ value: ActivityVerbFilterWire; label: string }> = [
  { value: 'archive', label: 'Archived' },
  { value: 'delete', label: 'Deleted' },
  { value: 'unsubscribe', label: 'Unsubscribed' },
  { value: 'later', label: 'Later' },
  { value: 'keep', label: 'Kept' },
  { value: 'followup-dismiss', label: 'Followups' },
];

function VerbChips({
  active,
  onChange,
}: {
  active: readonly ActivityVerbFilterWire[];
  onChange: (next: readonly ActivityVerbFilterWire[]) => void;
}) {
  const activeSet = useMemo(() => new Set(active), [active]);
  const toggle = (verb: ActivityVerbFilterWire) => {
    const next = new Set(activeSet);
    if (next.has(verb)) next.delete(verb);
    else next.add(verb);
    onChange([...next]);
  };
  return (
    <div
      role="group"
      aria-label="Filter by verb"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}
    >
      <span
        style={{
          fontSize: 11,
          fontFamily: font.mono,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: color.fgMuted,
          marginRight: 4,
        }}
      >
        Verb:
      </span>
      {VERB_CHIPS.map((chip) => (
        <Chip
          key={chip.value}
          label={chip.label}
          isActive={activeSet.has(chip.value)}
          onClick={() => toggle(chip.value)}
          tone="muted"
        />
      ))}
      {active.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          style={{
            background: 'transparent',
            border: 'none',
            color: color.fgMuted,
            fontFamily: font.mono,
            fontSize: 11,
            cursor: 'pointer',
            marginLeft: 4,
          }}
        >
          clear
        </button>
      )}
    </div>
  );
}

// ── Window + date range (D55 + B10) ───────────────────────────────────

const WINDOWS: ReadonlyArray<{ value: ActivityWindowWire; label: string }> = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

function WindowAndDateRow({
  window,
  dateFrom,
  dateTo,
  onWindow,
  onRange,
}: {
  window: ActivityWindowWire;
  dateFrom: string | null;
  dateTo: string | null;
  onWindow: (next: ActivityWindowWire) => void;
  onRange: (from: string | null, to: string | null) => void;
}) {
  const isCustomRange = dateFrom !== null || dateTo !== null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {WINDOWS.map((opt) => (
        <Chip
          key={opt.value}
          label={opt.label}
          isActive={!isCustomRange && window === opt.value}
          onClick={() => onWindow(opt.value)}
          tone="muted"
        />
      ))}
      <span
        aria-hidden="true"
        style={{ color: color.fgMuted, fontFamily: font.mono, fontSize: 11 }}
      >
        or
      </span>
      <DateInput
        label="From"
        value={isoDateOnly(dateFrom)}
        onChange={(v) => onRange(v ? new Date(`${v}T00:00:00Z`).toISOString() : null, dateTo)}
      />
      <DateInput
        label="To"
        value={isoDateOnly(dateTo)}
        onChange={(v) => onRange(dateFrom, v ? new Date(`${v}T00:00:00Z`).toISOString() : null)}
      />
      {isCustomRange && (
        <button
          type="button"
          onClick={() => onRange(null, null)}
          style={{
            background: 'transparent',
            border: 'none',
            color: color.fgMuted,
            fontFamily: font.mono,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          clear range
        </button>
      )}
    </div>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          fontFamily: font.mono,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: color.fgMuted,
        }}
      >
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          fontSize: 12,
          fontFamily: font.sans,
          padding: '3px 6px',
          border: `1px solid ${color.lineSoft}`,
          borderRadius: 6,
          background: color.card,
          color: color.fg,
        }}
      />
    </label>
  );
}

// ── Tools row: sender search + group toggle + CSV (B9 + B11 + B14) ────

type GroupMode = 'none' | 'sender';

function ToolsRow({
  senderQuery,
  onSenderQuery,
  groupMode,
  onGroupMode,
  rows,
  filters,
}: {
  senderQuery: string;
  onSenderQuery: (next: string) => void;
  groupMode: GroupMode;
  onGroupMode: (next: GroupMode) => void;
  rows: readonly ActivityRowWire[];
  filters: ActivityFilters;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <SenderSearchInput value={senderQuery} onChange={onSenderQuery} />
      <Chip
        label={groupMode === 'sender' ? 'Grouped' : 'Group by sender'}
        isActive={groupMode === 'sender'}
        onClick={() => onGroupMode(groupMode === 'sender' ? 'none' : 'sender')}
        tone="muted"
      />
      <ExportCsvButton rows={rows} filters={filters} />
    </div>
  );
}

function SenderSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  // Debounced local state — onChange fires 250ms after the user
  // stops typing so we don't push a URL update + re-fetch per keystroke.
  const [draft, setDraft] = useState(value);
  const lastPushed = useRef(value);
  useEffect(() => {
    // Reset local draft when the URL changes from elsewhere (back button,
    // clear button, etc.).
    if (value !== lastPushed.current) {
      setDraft(value);
      lastPushed.current = value;
    }
  }, [value]);
  useEffect(() => {
    const handle = setTimeout(() => {
      if (draft !== lastPushed.current) {
        lastPushed.current = draft;
        onChange(draft);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [draft, onChange]);
  return (
    <input
      type="search"
      placeholder="Search sender…"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      aria-label="Search sender"
      style={{
        fontSize: 12.5,
        fontFamily: font.sans,
        padding: '6px 10px',
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 999,
        background: color.card,
        color: color.fg,
        minWidth: 200,
      }}
    />
  );
}

// ── CSV export (B14) ──────────────────────────────────────────────────

function ExportCsvButton({
  rows,
  filters,
}: {
  rows: readonly ActivityRowWire[];
  filters: ActivityFilters;
}) {
  const disabled = rows.length === 0;
  return (
    <button
      type="button"
      onClick={() => {
        if (rows.length === 0) return;
        const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `declutrmail-activity-${filterFilenameSuffix(filters)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Defer revoke so Safari/Firefox finish reading the blob.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}
      disabled={disabled}
      title={disabled ? 'Nothing to export at the current filters.' : 'Export visible rows as CSV.'}
      style={{
        fontSize: 12.5,
        fontFamily: font.sans,
        padding: '6px 12px',
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 999,
        background: 'transparent',
        color: disabled ? color.fgMuted : color.fg,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      Export CSV
    </button>
  );
}

// ── Bulk action bar (B7) ──────────────────────────────────────────────

function BulkActionBar({
  rows,
  selectedIds,
  onClear,
}: {
  rows: readonly ActivityRowWire[];
  selectedIds: Set<string>;
  onClear: () => void;
}) {
  const revert = useRevertActivity();
  // Only rows with an available undo are valid bulk-undo targets.
  // Show the count of revertable selections vs the total selection
  // so the user can SEE that a stale / expired row was skipped.
  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const revertableCount = selectedRows.filter((r) => r.undoState.kind === 'available').length;
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  if (selectedIds.size === 0) return null;

  const runBulkUndo = async () => {
    setBulkBusy(true);
    setBulkError(null);
    const targets = selectedRows
      .filter((r) => r.undoState.kind === 'available')
      .map((r) => (r.undoState.kind === 'available' ? r.undoState.token : null))
      .filter((token): token is string => token !== null);
    // Parallel — each POST hits its own undo journal row; the BE rate
    // limiter (30/min on gmail-action) bounds the burst.
    const results = await Promise.allSettled(targets.map((token) => revert.mutateAsync(token)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      setBulkError(
        `${failed} of ${targets.length} undo${targets.length === 1 ? '' : 's'} failed. Try again from the row.`,
      );
    } else {
      onClear();
    }
    setBulkBusy(false);
  };

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        background: color.primarySoft,
        border: `1px solid ${color.primaryBorder}`,
        borderRadius: 10,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: color.fg }}>
        {selectedIds.size} selected
        {revertableCount < selectedIds.size && (
          <span style={{ fontWeight: 400, color: color.fgMuted, marginLeft: 6 }}>
            ({revertableCount} undoable)
          </span>
        )}
      </span>
      <Button
        tone="primary"
        size="sm"
        onClick={runBulkUndo}
        disabled={revertableCount === 0 || bulkBusy}
      >
        {bulkBusy ? 'Undoing…' : `Undo ${revertableCount}`}
      </Button>
      <button
        type="button"
        onClick={onClear}
        style={{
          background: 'transparent',
          border: 'none',
          color: color.fgMuted,
          fontFamily: font.mono,
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        clear selection
      </button>
      {bulkError && (
        <span style={{ fontSize: 12, color: color.amber, fontFamily: font.mono }}>{bulkError}</span>
      )}
    </div>
  );
}

// ── Grouped list (B11) ────────────────────────────────────────────────

interface SenderGroup {
  key: string;
  displayName: string;
  email: string;
  domain: string;
  rows: ActivityRowWire[];
}

function groupBySender(rows: readonly ActivityRowWire[]): SenderGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, SenderGroup>();
  for (const row of rows) {
    const key = row.sender ? row.sender.senderKey : `__account__:${row.id}`;
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        displayName: row.sender?.displayName ?? 'Account-scoped action',
        email: row.sender?.email ?? '',
        domain: row.sender?.domain ?? '',
        rows: [],
      };
      byKey.set(key, group);
      order.push(key);
    }
    group.rows.push(row);
  }
  return order.map((k) => byKey.get(k)!);
}

function GroupedList({
  rows,
  selectedIds,
  onToggle,
}: {
  rows: readonly ActivityRowWire[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const groups = useMemo(() => groupBySender(rows), [rows]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return (
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
      {groups.map((group) => {
        const isOpen = expanded.has(group.key);
        const totalAffected = group.rows.reduce((sum, r) => sum + r.affectedCount, 0);
        return (
          <li
            key={group.key}
            style={{
              background: color.card,
              border: `1px solid ${color.lineSoft}`,
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              aria-expanded={isOpen}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(180px, 1.2fr) auto auto',
                alignItems: 'center',
                gap: 14,
                padding: '12px 14px',
                width: '100%',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: font.sans,
                textAlign: 'left',
              }}
            >
              <Avatar size={32} name={group.displayName} domain={group.email} />
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
                  {group.displayName}
                </div>
                {group.domain && (
                  <div style={{ fontSize: 12, color: color.fgMuted, fontFamily: font.mono }}>
                    {group.domain}
                  </div>
                )}
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: color.fgMuted,
                  fontFamily: font.mono,
                  whiteSpace: 'nowrap',
                }}
              >
                {group.rows.length} action{group.rows.length === 1 ? '' : 's'} · {totalAffected}{' '}
                email{totalAffected === 1 ? '' : 's'}
              </span>
              <span aria-hidden="true" style={{ color: color.fgMuted }}>
                {isOpen ? '▾' : '▸'}
              </span>
            </button>
            {isOpen && (
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: '0 12px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {group.rows.map((row) => (
                  <ActivityRow
                    key={row.id}
                    row={row}
                    isSelected={selectedIds.has(row.id)}
                    onToggleSelect={() => onToggle(row.id)}
                    variant="grouped"
                  />
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Row ───────────────────────────────────────────────────────────────

function ActivityRow({
  row,
  isSelected,
  onToggleSelect,
  variant = 'flat',
}: {
  row: ActivityRowWire;
  isSelected: boolean;
  onToggleSelect: () => void;
  variant?: 'flat' | 'grouped';
}) {
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
        // checkbox · avatar · sender · verb+count · pill · undo · open · time
        gridTemplateColumns:
          variant === 'grouped'
            ? 'auto auto minmax(140px, 1fr) auto auto auto auto'
            : 'auto auto minmax(180px, 1.2fr) minmax(140px, 1fr) auto auto auto auto',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: variant === 'grouped' ? color.paper : color.card,
        border: variant === 'grouped' ? 'none' : `1px solid ${color.lineSoft}`,
        borderRadius: 8,
        fontFamily: font.sans,
      }}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggleSelect}
        aria-label={`Select activity row from ${senderName}`}
        style={{ cursor: 'pointer' }}
      />
      <Avatar size={28} name={senderName} domain={senderEmail} />
      {variant === 'flat' ? (
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
      ) : null}
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
      <UndoCell row={row} />
      <OpenInGmailLink row={row} />
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
 * B12 — "Open in Gmail" per row. The Gmail web UI accepts a Message-Id
 * search via `#search/rfc822msgid:<id>` (works for INBOX AND Trash);
 * `activity_log` rows only carry `senderKey` (not `messageId`), so for
 * single-message rows we fall back to a sender search via `from:`.
 *
 * Privacy (D7): the link is built FE-side from the already-rendered
 * sender email — no new data flows through the BE.
 */
function OpenInGmailLink({ row }: { row: ActivityRowWire }) {
  if (!row.sender) return <span aria-hidden="true" />;
  const href = `https://mail.google.com/mail/u/0/#search/from:${encodeURIComponent(row.sender.email)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${row.sender.displayName} in Gmail`}
      style={{
        fontSize: 11,
        fontFamily: font.mono,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: color.fgMuted,
        textDecoration: 'none',
        padding: '2px 8px',
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 6,
      }}
    >
      ↗ GMAIL
    </a>
  );
}

/**
 * D58 + B7/B13 — wired undo affordance.
 *
 * On click: POST /api/undo/:token via `useRevertActivity`. On success
 * the activity list cache invalidates and the row's `undoState` flips
 * to `executed` on the next render. On failure the cell renders a
 * "Try again" pill carrying the underlying error — addresses the
 * silent-failure class from MISTAKES.md 2026-06-05 + the stuck-revert
 * recovery path the handoff calls out.
 */
function UndoCell({ row }: { row: ActivityRowWire }) {
  const revert = useRevertActivity();
  const undo = row.undoState;

  // Mutation state lives per-row via the hook's mutationKey-free shape:
  // we read `revert.isPending` + `revert.error` directly. Multiple
  // rows share the same hook instance, so `isPending` flips for any
  // in-flight revert — gate the visual pending state on `variables`.
  const isPendingHere = revert.isPending && revert.variables === lastToken(undo);

  if (undo.kind === 'available') {
    const failed = revert.isError && revert.variables === undo.token;
    return (
      <button
        type="button"
        onClick={() => revert.mutate(undo.token)}
        disabled={isPendingHere}
        title={
          failed
            ? `Last attempt failed: ${revert.error?.message ?? 'unknown error'}. Click to retry.`
            : 'Revert this action.'
        }
        style={{
          fontSize: 12.5,
          color: failed ? color.amber : color.primary,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: isPendingHere ? 'wait' : 'pointer',
          fontWeight: failed ? 600 : 400,
        }}
      >
        {isPendingHere ? 'Undoing…' : failed ? 'Try again →' : 'Undo →'}
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

/** Helper for the row-pending guard — extract the token from an undo state. */
function lastToken(undo: ActivityRowWire['undoState']): string | null {
  return undo.kind === 'available' ? undo.token : null;
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

// ── Generic chip ──────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────

const ACTION_LABEL: Record<ActivityActionWire, string> = {
  keep: 'Kept',
  archive: 'Archived',
  unsubscribe: 'Unsubscribed',
  later: 'Later',
  // D227 K/A/U/L/D — Delete verb (ADR-0019). The audit copy uses
  // "Deleted" rather than "Trashed" to stay verb-symmetric with
  // "Archived"; spec L312 confirms "Delete" is the user-facing verb.
  delete: 'Deleted',
  'followup-dismiss': 'Followup resolved',
};

const SOURCE_LABEL: Record<ActivityRowWire['source'], string> = {
  triage: 'Triage',
  manual: 'Manual',
  autopilot: 'Autopilot',
  screener: 'Screener',
};

const ALLOWED_VERBS: ReadonlySet<ActivityVerbFilterWire> = new Set([
  'keep',
  'archive',
  'unsubscribe',
  'later',
  'delete',
  'followup-dismiss',
]);

function readFiltersFromUrl(params: URLSearchParams): ActivityFilters {
  return {
    window: readWindow(params.get('window')),
    source: readSource(params.get('source')),
    verbs: readVerbs(params.get('verb')),
    senderQuery: (params.get('sender_q') ?? '').trim(),
    dateFrom: readIsoDate(params.get('date_from')),
    dateTo: readIsoDate(params.get('date_to')),
  };
}

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

function readVerbs(raw: string | null): readonly ActivityVerbFilterWire[] {
  if (!raw) return [];
  const seen = new Set<ActivityVerbFilterWire>();
  for (const token of raw.split(',')) {
    const trimmed = token.trim();
    if (ALLOWED_VERBS.has(trimmed as ActivityVerbFilterWire)) {
      seen.add(trimmed as ActivityVerbFilterWire);
    }
  }
  return [...seen];
}

function readIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function readGroupMode(raw: string | null): GroupMode {
  return raw === 'sender' ? 'sender' : 'none';
}

function windowToLabel(
  window: ActivityWindowWire,
  dateFrom: string | null,
  dateTo: string | null,
): string {
  if (dateFrom || dateTo) {
    const fromStr = dateFrom
      ? new Date(dateFrom).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '…';
    const toStr = dateTo
      ? new Date(dateTo).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '…';
    return `${fromStr} – ${toStr}`;
  }
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

function isoDateOnly(iso: string | null): string {
  if (!iso) return '';
  // Truncate to YYYY-MM-DD so `<input type="date">` round-trips.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ── CSV builder ───────────────────────────────────────────────────────

/**
 * Build a CSV from the visible activity rows. Columns mirror what the
 * user sees on screen — no body-adjacent fields (D7/D228 holds for
 * exports too).
 */
export function rowsToCsv(rows: readonly ActivityRowWire[]): string {
  const header = [
    'Occurred At',
    'Verb',
    'Source',
    'Sender Name',
    'Sender Email',
    'Affected Messages',
    'Undo State',
  ].join(',');
  const lines = rows.map((row) =>
    [
      row.occurredAt,
      ACTION_LABEL[row.action],
      SOURCE_LABEL[row.source],
      row.sender?.displayName ?? '',
      row.sender?.email ?? '',
      String(row.affectedCount),
      row.undoState.kind,
    ]
      .map(csvField)
      .join(','),
  );
  return [header, ...lines].join('\n');
}

function csvField(value: string): string {
  // Quote if the value contains a comma, quote, or newline; double any
  // embedded quotes per RFC 4180.
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function filterFilenameSuffix(filters: ActivityFilters): string {
  const parts: string[] = [];
  if (filters.window) parts.push(filters.window);
  if (filters.source && filters.source !== 'all') parts.push(filters.source);
  if (filters.verbs && filters.verbs.length > 0) parts.push(filters.verbs.join('-'));
  if (filters.dateFrom || filters.dateTo) parts.push('custom');
  return parts.join('-') || 'all';
}
