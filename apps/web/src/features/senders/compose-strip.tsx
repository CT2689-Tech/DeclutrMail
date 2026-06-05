'use client';

/**
 * ComposeStrip — D38 "powerful filters" surface.
 *
 * Replaces the 4 stacked strips (KPI · fact-chips · sort hint · result-
 * count) with ONE compose row + a hero number. Multi-axis faceted
 * filter, AND across axes:
 *
 *   • Activity bucket (radio across active / quiet / dormant)
 *   • Has-unsub toggle (tri-state: required / negated / absent)
 *   • You-replied toggle (tri-state)
 *   • Protected toggle (tri-state)
 *   • Quiet-for window (popover: any / 30d / 90d / 6mo / 1yr)
 *   • Domain substring (popover with free-text + suggestions)
 *
 * Negation: Alt-click or right-click any chip flips to the negated
 * form (red), encoding "NOT this". Counts on chips are MAILBOX-WIDE
 * absolutes — they're what each axis holds independently, ignoring
 * the rest of the compose, so the user can predict the next click.
 *
 * The compose result lives in URL state so a scope link is shareable
 * + refresh-stable. The strip is otherwise stateless — host owns the
 * compose object.
 */

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { tokens } from '@declutrmail/shared';
import type { ActivityBucket, TriStateFilter } from '@/lib/api/senders';

const { color, font } = tokens;

export interface ComposeState {
  activity: ActivityBucket | null;
  /** When true, the activity bucket is NEGATED (NOT-active, etc.). */
  activityNegate: boolean;
  unsubReady: TriStateFilter;
  replied: TriStateFilter;
  protectedFlag: TriStateFilter;
  windowDays: number | null;
  domain: string | null;
}

export const EMPTY_COMPOSE: ComposeState = {
  activity: null,
  activityNegate: false,
  unsubReady: null,
  replied: null,
  protectedFlag: null,
  windowDays: null,
  domain: null,
};

export interface ComposeCounts {
  total: number;
  active: number;
  quiet: number;
  dormant: number;
  unsubReady: number;
  repliedTo: number;
  protected: number;
}

export function ComposeStrip({
  state,
  counts,
  onChange,
  onClear,
  domainSuggestions,
}: {
  state: ComposeState;
  /** Mailbox-wide absolute counts per axis. May be undefined while loading. */
  counts: ComposeCounts | undefined;
  onChange: (next: ComposeState) => void;
  onClear: () => void;
  /** Up to ~6 top domains for the popover quick-pick. */
  domainSuggestions: string[];
}) {
  return (
    <div
      aria-label="Compose senders scope"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px 14px',
        padding: '14px 0',
        borderTop: `1px solid ${color.line}`,
        borderBottom: `1px solid ${color.line}`,
      }}
    >
      <AxisLabel>activity</AxisLabel>
      <ActivityChip bucket="active" state={state} count={counts?.active} onChange={onChange} />
      <ActivityChip bucket="quiet" state={state} count={counts?.quiet} onChange={onChange} />
      <ActivityChip bucket="dormant" state={state} count={counts?.dormant} onChange={onChange} />

      <Divider />

      <ToggleChip
        label="has unsub"
        count={counts?.unsubReady}
        value={state.unsubReady}
        onChange={(unsubReady) => onChange({ ...state, unsubReady })}
      />
      <ToggleChip
        label="you replied"
        count={counts?.repliedTo}
        value={state.replied}
        onChange={(replied) => onChange({ ...state, replied })}
      />
      <ToggleChip
        label="protected"
        count={counts?.protected}
        value={state.protectedFlag}
        onChange={(protectedFlag) => onChange({ ...state, protectedFlag })}
      />

      <Divider />

      <WindowMenu
        windowDays={state.windowDays}
        onChange={(windowDays) => onChange({ ...state, windowDays })}
      />
      <DomainMenu
        value={state.domain}
        onChange={(domain) => onChange({ ...state, domain })}
        suggestions={domainSuggestions}
      />

      <span style={{ flex: 1 }} />

      {hasAnyFilter(state) && (
        <button
          type="button"
          onClick={onClear}
          style={{
            fontFamily: font.mono,
            fontSize: 11,
            color: 'var(--color-amber)',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            letterSpacing: '0.04em',
          }}
        >
          clear filters [×]
        </button>
      )}
    </div>
  );
}

function hasAnyFilter(s: ComposeState): boolean {
  return (
    s.activity !== null ||
    s.unsubReady !== null ||
    s.replied !== null ||
    s.protectedFlag !== null ||
    s.windowDays !== null ||
    s.domain !== null
  );
}

/* ─── primitives ────────────────────────────────────────────────── */

function AxisLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: font.mono,
        fontSize: 10,
        letterSpacing: '0.10em',
        color: color.fgMuted,
        textTransform: 'uppercase',
        marginRight: 2,
      }}
    >
      {children}
    </span>
  );
}

function Divider() {
  return (
    <span
      aria-hidden
      style={{
        width: 1,
        height: 18,
        background: color.line,
      }}
    />
  );
}

function ActivityChip({
  bucket,
  state,
  count,
  onChange,
}: {
  bucket: ActivityBucket;
  state: ComposeState;
  count: number | undefined;
  onChange: (next: ComposeState) => void;
}) {
  const isActive = state.activity === bucket && !state.activityNegate;
  const isNegated = state.activity === bucket && state.activityNegate;

  const cycle = (negate: boolean) => {
    if (isActive && !negate) return onChange({ ...state, activity: null, activityNegate: false });
    if (isNegated && negate) return onChange({ ...state, activity: null, activityNegate: false });
    onChange({ ...state, activity: bucket, activityNegate: negate });
  };

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive || isNegated}
      onClick={(e) => cycle(e.altKey)}
      onContextMenu={(e) => {
        e.preventDefault();
        cycle(true);
      }}
      style={chipStyle({ active: isActive, negated: isNegated })}
    >
      <span>{bucket}</span>
      {count !== undefined && (
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 11,
            color: 'inherit',
            opacity: isActive || isNegated ? 0.85 : 0.6,
          }}
        >
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

function ToggleChip({
  label,
  count,
  value,
  onChange,
}: {
  label: string;
  count: number | undefined;
  value: TriStateFilter;
  onChange: (next: TriStateFilter) => void;
}) {
  const active = value === true;
  const negated = value === false;

  const cycle = (e: MouseEvent | { altKey: boolean }) => {
    const negate = 'altKey' in e ? e.altKey : false;
    if (negate) {
      onChange(value === false ? null : false);
    } else {
      if (value === true) onChange(null);
      else if (value === false) onChange(true);
      else onChange(true);
    }
  };

  return (
    <button
      type="button"
      onClick={cycle}
      onContextMenu={(e) => {
        e.preventDefault();
        cycle({ altKey: true });
      }}
      style={chipStyle({ active, negated, withCheckbox: true })}
    >
      <span
        style={{
          width: 13,
          height: 13,
          borderRadius: 3,
          border: '1.5px solid currentColor',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: active ? 'currentColor' : 'transparent',
          color: 'inherit',
          fontSize: 9,
          fontWeight: 700,
        }}
        aria-hidden
      >
        {active && <span style={{ color: color.card, lineHeight: 1, fontSize: 9 }}>✓</span>}
        {negated && <span style={{ color: 'inherit', lineHeight: 1, fontSize: 9 }}>✕</span>}
      </span>
      <span>{label}</span>
      {count !== undefined && (
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 11,
            color: 'inherit',
            opacity: active || negated ? 0.85 : 0.6,
          }}
        >
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

function chipStyle({
  active,
  negated,
  withCheckbox = false,
}: {
  active: boolean;
  negated: boolean;
  withCheckbox?: boolean;
}): React.CSSProperties {
  const bg = active ? color.fg : negated ? 'rgba(161,37,37,0.06)' : color.card;
  const fg = active ? color.card : negated ? '#A12525' : color.fgSoft;
  const border = active ? color.fg : negated ? 'rgba(161,37,37,0.30)' : color.line;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: withCheckbox ? 7 : 6,
    padding: withCheckbox ? '5px 11px 5px 9px' : '5px 11px',
    border: `1px solid ${border}`,
    borderRadius: 999,
    background: bg,
    color: fg,
    font: 'inherit',
    fontSize: 12.5,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
    userSelect: 'none',
  };
}

/* ─── window menu ───────────────────────────────────────────────── */

const WINDOW_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'any time', value: null },
  { label: '30 days+', value: 30 },
  { label: '90 days+', value: 90 },
  { label: '6 months+', value: 180 },
  { label: '1 year+', value: 365 },
];

function WindowMenu({
  windowDays,
  onChange,
}: {
  windowDays: number | null;
  onChange: (next: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const active = windowDays !== null;
  const label = WINDOW_OPTIONS.find((o) => o.value === windowDays)?.label ?? 'any time';
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...chipStyle({ active, negated: false }),
          gap: 4,
        }}
      >
        <AxisLabel>quiet for</AxisLabel>
        <span>{label}</span>
        <span style={{ fontSize: 9, color: color.fgMuted, marginLeft: 2 }}>▾</span>
      </button>
      {open && (
        <Popover>
          {WINDOW_OPTIONS.map((opt) => (
            <PopoverItem
              key={String(opt.value)}
              active={opt.value === windowDays}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </PopoverItem>
          ))}
        </Popover>
      )}
    </span>
  );
}

/* ─── domain menu ───────────────────────────────────────────────── */

function DomainMenu({
  value,
  onChange,
  suggestions,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  suggestions: string[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    const onDoc = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        const trimmed = draft.trim().toLowerCase();
        onChange(trimmed.length === 0 ? null : trimmed);
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDraft(value ?? '');
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line
  }, [open, draft, value]);
  const active = !!value;
  const label = value ?? 'any';
  const filtered =
    draft.trim().length === 0
      ? suggestions.slice(0, 6)
      : suggestions.filter((d) => d.includes(draft.trim().toLowerCase())).slice(0, 6);
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ ...chipStyle({ active, negated: false }), gap: 4 }}
      >
        <AxisLabel>domain</AxisLabel>
        <span>{label}</span>
        <span style={{ fontSize: 9, color: color.fgMuted, marginLeft: 2 }}>▾</span>
      </button>
      {open && (
        <Popover>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const trimmed = draft.trim().toLowerCase();
                onChange(trimmed.length === 0 ? null : trimmed);
                setOpen(false);
              }
            }}
            placeholder="amazon.com / linkedin / …"
            style={{
              width: '100%',
              padding: '6px 8px',
              fontFamily: font.mono,
              fontSize: 12,
              border: `1px solid ${color.line}`,
              borderRadius: 6,
              background: color.paper,
              color: color.fg,
              outline: 'none',
              marginBottom: 6,
            }}
          />
          {value && (
            <PopoverItem
              active={false}
              onClick={() => {
                setDraft('');
                onChange(null);
                setOpen(false);
              }}
              tone="amber"
            >
              clear domain ←
            </PopoverItem>
          )}
          {filtered.map((d) => (
            <PopoverItem
              key={d}
              active={d === value}
              onClick={() => {
                onChange(d);
                setOpen(false);
              }}
            >
              {d}
            </PopoverItem>
          ))}
        </Popover>
      )}
    </span>
  );
}

/* ─── popover primitive ────────────────────────────────────────── */

function Popover({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="menu"
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        left: 0,
        zIndex: 60,
        minWidth: 220,
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 9,
        boxShadow: '0 16px 44px rgba(14,20,19,0.16)',
        padding: 6,
        display: 'block',
        fontFamily: font.sans,
      }}
    >
      {children}
    </span>
  );
}

function PopoverItem({
  active,
  onClick,
  children,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: 'amber' | undefined;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '7px 10px',
        background: active ? 'rgba(14,20,19,0.05)' : 'transparent',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        font: 'inherit',
        fontFamily: font.sans,
        fontSize: 13,
        color: tone === 'amber' ? 'var(--color-amber)' : color.fg,
        textAlign: 'left',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 12,
          color: active ? color.fg : 'transparent',
          fontWeight: 600,
        }}
      >
        ✓
      </span>
      <span style={{ flex: 1 }}>{children}</span>
    </button>
  );
}
