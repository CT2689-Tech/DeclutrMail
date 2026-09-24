'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { tokens } from '@declutrmail/shared';

import type {
  ActivityReviewOutcomeWire,
  ActivitySourceFilterWire,
  ActivityVerbFilterWire,
  ActivityWindowWire,
} from '@/lib/api/activity';

/**
 * Activity filter controls, shared by the screen and the lazily loaded
 * support-bundle dialog. Lives in its own module so the dialog can reuse
 * the fields without importing the screen (no import cycle).
 */

const { color, font, motion, radius, text } = tokens;

/** Standalone numerals — sans, tabular, so columns of counts line up. */
export const numeralStyle: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
};

export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export type GroupMode = 'none' | 'sender';

export const SOURCE_CHIPS: ReadonlyArray<{ value: ActivitySourceFilterWire; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'triage', label: 'Triage' },
  { value: 'autopilot', label: 'Autopilot' },
  { value: 'screener', label: 'Screener' },
  { value: 'manual', label: 'Manual' },
];

export const VERB_CHIPS: ReadonlyArray<{ value: ActivityVerbFilterWire; label: string }> = [
  { value: 'archive', label: 'Archived' },
  { value: 'delete', label: 'Deleted' },
  // D9 — filters the `unsubscribe` intent rows; label matches the summary
  // ("Unsubscribes", not the success-claiming "Unsubscribed").
  { value: 'unsubscribe', label: 'Unsubscribes' },
  { value: 'later', label: 'Later' },
  { value: 'keep', label: 'Kept' },
  { value: 'followup-dismiss', label: 'Follow-ups' },
];

export const OUTCOME_CHIPS: ReadonlyArray<{ value: ActivityReviewOutcomeWire; label: string }> = [
  { value: 'completed', label: 'Completed' },
  { value: 'skipped', label: 'Dismissed by you' },
  { value: 'failed', label: 'Failed' },
  // A failed action that succeeded on retry — never a user's Undo, which
  // lands in no bucket here (QA-undo-20260828-03).
  { value: 'recovered', label: 'Fixed on retry' },
  { value: 'protected', label: 'Skipped for Protected' },
];

const WINDOWS: ReadonlyArray<{ value: ActivityWindowWire; label: string }> = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All' },
];

/**
 * The filter controls, shared verbatim between the desktop popover, the
 * mobile bottom sheet and the support-bundle dialog. Outcome, grouping and
 * sender search are optional: each host passes only what it owns.
 */
export interface FilterFieldsProps {
  source: ActivitySourceFilterWire;
  onSource: (next: ActivitySourceFilterWire) => void;
  verbs: readonly ActivityVerbFilterWire[];
  onVerbs: (next: readonly ActivityVerbFilterWire[]) => void;
  outcomes?: readonly ActivityReviewOutcomeWire[];
  onOutcomes?: (next: readonly ActivityReviewOutcomeWire[]) => void;
  window: ActivityWindowWire;
  dateFrom: string | null;
  dateTo: string | null;
  onWindow: (next: ActivityWindowWire) => void;
  onRange: (from: string | null, to: string | null) => void;
  groupMode?: GroupMode;
  onGroupMode?: (next: GroupMode) => void;
  senderQuery?: string;
  onSenderQuery?: (next: string) => void;
  senderSearchDebounceMs?: number;
  /** 44px targets for the bottom sheet. */
  touch?: boolean;
  /** False where the action chips already sit on the page. */
  showVerbs?: boolean;
}

export function FilterFields({
  source,
  onSource,
  verbs,
  onVerbs,
  outcomes,
  onOutcomes,
  window,
  dateFrom,
  dateTo,
  onWindow,
  onRange,
  groupMode,
  onGroupMode,
  senderQuery,
  onSenderQuery,
  senderSearchDebounceMs,
  touch = false,
  showVerbs = true,
}: FilterFieldsProps) {
  const isCustomRange = dateFrom !== null || dateTo !== null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <FilterGroup label="Source">
        {SOURCE_CHIPS.map((chip) => (
          <Chip
            key={chip.value}
            label={chip.label}
            isActive={source === chip.value}
            onClick={() => onSource(chip.value)}
            touch={touch}
          />
        ))}
      </FilterGroup>
      {showVerbs && (
        <FilterGroup label="Action">
          {VERB_CHIPS.map((chip) => (
            <Chip
              key={chip.value}
              label={chip.label}
              isActive={verbs.includes(chip.value)}
              onClick={() => onVerbs(toggled(verbs, chip.value))}
              touch={touch}
            />
          ))}
        </FilterGroup>
      )}
      {outcomes && onOutcomes && (
        <FilterGroup label="Outcome">
          {OUTCOME_CHIPS.map((chip) => (
            <Chip
              key={chip.value}
              label={chip.label}
              isActive={outcomes.includes(chip.value)}
              onClick={() => onOutcomes(toggled(outcomes, chip.value))}
              touch={touch}
            />
          ))}
        </FilterGroup>
      )}
      <FilterGroup label="Time">
        {WINDOWS.map((opt) => (
          <Chip
            key={opt.value}
            label={opt.label}
            isActive={!isCustomRange && window === opt.value}
            onClick={() => onWindow(opt.value)}
            touch={touch}
          />
        ))}
        <DateInput
          label="From"
          value={isoDateOnly(dateFrom)}
          onChange={(v) => onRange(safeIsoFromDateInput(v), dateTo)}
        />
        <DateInput
          label="To"
          value={isoDateOnly(dateTo)}
          onChange={(v) => onRange(dateFrom, safeIsoFromDateInput(v))}
        />
        {isCustomRange && (
          <button type="button" onClick={() => onRange(null, null)} style={textButtonStyle}>
            Clear range
          </button>
        )}
      </FilterGroup>
      {groupMode !== undefined && onGroupMode && (
        <FilterGroup label="View">
          <Chip
            label="Group by sender"
            isActive={groupMode === 'sender'}
            onClick={() => onGroupMode(groupMode === 'sender' ? 'none' : 'sender')}
            touch={touch}
          />
        </FilterGroup>
      )}
      {senderQuery !== undefined && onSenderQuery && (
        <FilterGroup label="Sender">
          <SenderSearchInput
            value={senderQuery}
            onChange={onSenderQuery}
            debounceMs={senderSearchDebounceMs}
          />
        </FilterGroup>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <span style={{ fontSize: text.xs, color: color.fgMuted }}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

export const textButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 4,
  fontFamily: font.sans,
  fontSize: text.sm,
  color: color.fgMuted,
  cursor: 'pointer',
};

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
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 36,
        padding: '0 12px',
        background: color.fill,
        borderRadius: radius.pill,
      }}
    >
      <span style={{ fontSize: text.xs, color: color.fgMuted }}>{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...numeralStyle,
          fontSize: text.sm,
          padding: '2px 0',
          border: 'none',
          background: 'transparent',
          color: color.fg,
          outline: 'none',
        }}
      />
    </label>
  );
}

export function SenderSearchInput({
  value,
  onChange,
  debounceMs = 250,
  fullWidth = false,
}: {
  value: string;
  onChange: (next: string) => void;
  debounceMs?: number | undefined;
  /** Mobile header: the search takes its own line. */
  fullWidth?: boolean;
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
    if (debounceMs === 0) return;
    const handle = setTimeout(() => {
      if (draft !== lastPushed.current) {
        lastPushed.current = draft;
        onChange(draft);
      }
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [debounceMs, draft, onChange]);
  return (
    <label
      style={{
        boxSizing: 'border-box',
        display: fullWidth ? 'flex' : 'inline-flex',
        alignItems: 'center',
        gap: 8,
        minHeight: fullWidth ? 44 : 40,
        padding: '0 16px',
        background: color.fill,
        borderRadius: radius.pill,
        minWidth: 240,
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        aria-hidden="true"
        style={{ color: color.fgMuted, flexShrink: 0 }}
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        placeholder="Search sender…"
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (debounceMs === 0) {
            lastPushed.current = next;
            onChange(next);
          }
        }}
        aria-label="Search sender"
        style={{
          fontSize: text.base,
          fontFamily: font.sans,
          padding: '2px 0',
          border: 'none',
          background: 'transparent',
          color: color.fg,
          outline: 'none',
          flex: 1,
          minWidth: 0,
        }}
      />
    </label>
  );
}

// ── Generic chip ──────────────────────────────────────────────────────

function Chip({
  label,
  isActive,
  onClick,
  touch = false,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  /** 44px target inside the mobile bottom sheet. */
  touch?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      style={{
        minHeight: touch ? 44 : 28,
        padding: touch ? '0 16px' : '0 12px',
        fontSize: text.sm,
        fontFamily: font.sans,
        border: 'none',
        fontWeight: isActive ? 600 : 500,
        background: isActive ? color.primarySoft : color.fill,
        color: isActive ? color.primary : color.fg,
        borderRadius: radius.pill,
        cursor: 'pointer',
        transition: `background ${motion.fast} ${motion.ease}, border-color ${motion.fast} ${motion.ease}`,
      }}
    >
      {label}
    </button>
  );
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

/**
 * Parse a `<input type="date">` value into an ISO timestamp safely.
 * The native picker normalises to `YYYY-MM-DD` in compliant browsers,
 * but a future regression to `<input type="text">`, a Firefox quirk,
 * or a paste of garbage can yield an unparseable string. Returning null
 * on parse failure keeps the filter state honest (the URL clears
 * rather than getting `Invalid Date.toISOString()` throwing through a
 * React event handler and leaving the filter in a stuck state — the
 * silent-failure pattern flagged 2026-06-05 silent-failure-hunter).
 */
function safeIsoFromDateInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
