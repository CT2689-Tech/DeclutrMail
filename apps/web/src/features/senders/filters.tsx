'use client';

/**
 * Senders filters + sort (D38 "powerful filters", D51 saved views).
 *
 * The header shows two quiet buttons — `Filter` and `Sort: …` — and the
 * list. Every filter control lives behind `Filter` (a popover; a bottom
 * sheet on phones); what is switched on comes back as one row of
 * removable chips under the header (`ActiveFilterChips`).
 *
 * Multi-axis, AND across axes:
 *   • Activity bucket (active / quiet / dormant)
 *   • Has unsubscribe · You wrote to them · Protected (tri-state)
 *   • Unsubscribed, still emailing (on/off)
 *   • No email for (any / 30d / 90d / 6mo / 1yr)
 *   • Domain substring
 *
 * Exclusion: Alt-click or right-click a chip flips it to "not this".
 * Counts on chips are MAILBOX-WIDE absolutes — what each axis holds on
 * its own, ignoring the rest — so the next click is predictable.
 *
 * State is URL-backed by the host (`useComposeState`); everything here
 * is controlled.
 */

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { BottomSheet, tokens, useIsAtMost } from '@declutrmail/shared';
import { WINDOWS } from '@declutrmail/shared/senders';
import type {
  ActivityBucket,
  SenderListDirection,
  SenderListSort,
  TriStateFilter,
} from '@/lib/api/senders';

// The active/quiet/dormant thresholds these chips filter by. Mirrors the
// exact cutoffs `filterCountsQuery` uses (senders.read-service.ts). "quiet"
// is everything between; a sender last seen exactly ACTIVE_DAYS ago is
// Active, so Quiet starts strictly after it.
const ACTIVITY_BUCKET_TITLE: Record<ActivityBucket, string> = {
  active: `Last email within ${WINDOWS.ACTIVE_DAYS} days`,
  quiet: `Last email more than ${WINDOWS.ACTIVE_DAYS} and up to ${WINDOWS.DORMANT_DAYS} days ago`,
  dormant: `Last email over ${WINDOWS.DORMANT_DAYS} days ago`,
};

const { color, font, motion, radius, shadow, text } = tokens;

export interface ComposeState {
  activity: ActivityBucket | null;
  /** When true, the activity bucket is NEGATED (NOT-active, etc.). */
  activityNegate: boolean;
  unsubReady: TriStateFilter;
  wroteTo: TriStateFilter;
  protectedFlag: TriStateFilter;
  windowDays: number | null;
  domain: string | null;
  /**
   * D51 — "unsub'd, still emailing": standing unsubscribe policy but
   * mail kept arriving after it was recorded. On/off (no negated form —
   * the complement isn't a scope anyone composes).
   */
  unsubIgnored: boolean;
}

export const EMPTY_COMPOSE: ComposeState = {
  activity: null,
  activityNegate: false,
  unsubReady: null,
  wroteTo: null,
  protectedFlag: null,
  windowDays: null,
  domain: null,
  unsubIgnored: false,
};

/**
 * First-visit compose (launch-audit B2). A pristine `/senders` URL
 * opens on ACTIVE senders only — the landing page promises a shortlist,
 * so the first screen must not be every sender ever seen. "All" stays
 * one tap away (the active chip toggles off → `?activity=all`), and
 * `EMPTY_COMPOSE` remains what "Clear" resolves to.
 */
export const DEFAULT_COMPOSE: ComposeState = {
  ...EMPTY_COMPOSE,
  activity: 'active',
};

export interface ComposeCounts {
  total: number;
  active: number;
  quiet: number;
  dormant: number;
  unsubReady: number;
  wroteTo: number;
  protected: number;
  /** D51 — may be undefined on older wire payloads; the chip then renders without a count. */
  unsubIgnored?: number | undefined;
}

export function hasAnyFilter(s: ComposeState): boolean {
  return (
    s.activity !== null ||
    s.unsubReady !== null ||
    s.wroteTo !== null ||
    s.protectedFlag !== null ||
    s.windowDays !== null ||
    s.domain !== null ||
    s.unsubIgnored
  );
}

/**
 * Is this compose exactly the first-visit default (active-only, B2)?
 * Field-wise compare — ComposeState is a flat closed shape, so drift
 * here fails typecheck when a new axis is added.
 */
export function isDefaultCompose(c: ComposeState): boolean {
  return (
    c.activity === DEFAULT_COMPOSE.activity &&
    c.activityNegate === DEFAULT_COMPOSE.activityNegate &&
    c.unsubReady === DEFAULT_COMPOSE.unsubReady &&
    c.wroteTo === DEFAULT_COMPOSE.wroteTo &&
    c.protectedFlag === DEFAULT_COMPOSE.protectedFlag &&
    c.windowDays === DEFAULT_COMPOSE.windowDays &&
    c.domain === DEFAULT_COMPOSE.domain &&
    c.unsubIgnored === DEFAULT_COMPOSE.unsubIgnored
  );
}

/* ─── header buttons ────────────────────────────────────────────── */

const CARET = (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

// Compact workspace controls share the editorial input geometry.
function headerButtonStyle(on: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 36,
    padding: '0 16px',
    border: `1px solid ${color.lineSoft}`,
    borderRadius: radius.md,
    background: on ? color.fillHover : color.card,
    color: color.fg,
    fontFamily: font.sans,
    fontSize: text.base,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: `background ${motion.fast} ${motion.ease}`,
  };
}

// Menus fade + scale from their anchor (top-right), and header capsules
// get the Button's hover step — both need selectors.
const FILTERS_CSS = `
@keyframes dm-menu-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
.dm-menu{transform-origin:top right;animation:dm-menu-in ${motion.fast} ${motion.ease}}
.dm-hdr-btn:hover{background:${color.fillHover} !important}
.dm-menu-row:hover,.dm-menu-row:focus-visible{background:${color.fill} !important}
`;

/** Close on outside mousedown + Escape while `open`. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref, close]);
}

const POPOVER_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  right: 0,
  zIndex: 60,
  maxWidth: 'calc(100vw - 32px)',
  maxHeight: 'min(70vh, 560px)',
  overflowY: 'auto',
  background: color.card,
  border: 'none',
  borderRadius: radius.xl,
  boxShadow: shadow.pop,
  fontFamily: font.sans,
};

export interface FilterPanelProps {
  state: ComposeState;
  /** Mailbox-wide absolute counts per axis. May be undefined while loading. */
  counts: ComposeCounts | undefined;
  /**
   * True while `counts` may be one response behind (an in-flight refetch
   * of the active query). Marks the group `aria-busy`; the chips stay
   * clickable and do NOT dim.
   */
  updating?: boolean;
  onChange: (next: ComposeState) => void;
  onClear: () => void;
  /** Top domains for the domain field's suggestions. */
  domainSuggestions: string[];
  /**
   * D51 saved filter views — host-supplied wiring. Omitted = section
   * hidden (bare renders / stories that don't exercise persistence).
   */
  views?: SavedViewsProps | undefined;
}

/**
 * `[Filter]` — the one door to every filter control. Counts how many
 * axes differ from a clean slate so a closed button still says
 * "something is narrowing this list".
 */
export function FilterButton(props: FilterPanelProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const isPhone = useIsAtMost('xs');
  const close = () => setOpen(false);
  useDismiss(open && !isPhone, ref, close);
  const n = isDefaultCompose(props.state) ? 0 : activeFilterChips(props.state).length;
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <style>{FILTERS_CSS}</style>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="dm-hdr-btn"
        style={headerButtonStyle(n > 0)}
      >
        Filter
        {n > 0 && (
          <span
            style={{
              fontSize: text.xs,
              fontWeight: 600,
              color: color.fgMuted,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {n}
          </span>
        )}
      </button>
      {isPhone ? (
        <BottomSheet open={open} onClose={close} ariaLabel="Filters">
          <FilterPanel {...props} />
        </BottomSheet>
      ) : (
        open && (
          <div
            role="dialog"
            aria-label="Filters"
            className="dm-menu"
            style={{ ...POPOVER_STYLE, width: 340 }}
          >
            <FilterPanel {...props} />
          </div>
        )
      )}
    </span>
  );
}

/** The filter controls themselves — what `[Filter]` opens. */
export function FilterPanel({
  state,
  counts,
  updating = false,
  onChange,
  onClear,
  domainSuggestions,
  views,
}: FilterPanelProps) {
  const isTouch = useIsAtMost('xs');
  return (
    <div
      role="group"
      aria-label="Filter senders"
      aria-busy={updating}
      style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}
    >
      <Section label="Activity" hint={isTouch ? undefined : 'Alt-click to exclude'}>
        <ActivityChip bucket="active" state={state} count={counts?.active} onChange={onChange} />
        <ActivityChip bucket="quiet" state={state} count={counts?.quiet} onChange={onChange} />
        <ActivityChip bucket="dormant" state={state} count={counts?.dormant} onChange={onChange} />
      </Section>

      <Section label="Show only">
        <ToggleChip
          label="has unsubscribe"
          count={counts?.unsubReady}
          value={state.unsubReady}
          onChange={(unsubReady) => onChange({ ...state, unsubReady })}
          negatedHint="No unsubscribe link found — or the sender hasn't been checked yet"
        />
        <ToggleChip
          label="you wrote to them"
          count={counts?.wroteTo}
          value={state.wroteTo}
          onChange={(wroteTo) => onChange({ ...state, wroteTo })}
        />
        <ToggleChip
          label="protected"
          count={counts?.protected}
          value={state.protectedFlag}
          onChange={(protectedFlag) => onChange({ ...state, protectedFlag })}
        />
        <OnOffChip
          label="unsubscribed, still emailing"
          count={counts?.unsubIgnored}
          active={state.unsubIgnored}
          onToggle={() => onChange({ ...state, unsubIgnored: !state.unsubIgnored })}
        />
      </Section>

      <Section label="No email for">
        {WINDOW_OPTIONS.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={opt.value === state.windowDays}
            onClick={() => onChange({ ...state, windowDays: opt.value })}
            style={chipStyle({ active: opt.value === state.windowDays, negated: false })}
          >
            {opt.label}
          </button>
        ))}
      </Section>

      <DomainField
        value={state.domain}
        onChange={(domain) => onChange({ ...state, domain })}
        suggestions={domainSuggestions}
      />

      {views && <SavedViews {...views} />}

      {hasAnyFilter(state) && (
        <button type="button" onClick={onClear} style={{ ...TEXT_BUTTON, alignSelf: 'flex-start' }}>
          Clear filters
        </button>
      )}
    </div>
  );
}

/* ─── primitives ────────────────────────────────────────────────── */

const TEXT_BUTTON: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  fontFamily: font.sans,
  fontSize: text.sm,
  fontWeight: 500,
  color: color.primary,
  cursor: 'pointer',
};

const FIELD_STYLE: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  height: 40,
  padding: '0 14px',
  fontFamily: font.sans,
  fontSize: text.base,
  border: 'none',
  borderRadius: radius.md,
  background: color.fill,
  color: color.fg,
};

function SectionLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <span id={id} style={{ fontSize: text.xs, color: color.fgMuted }}>
      {children}
    </span>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <SectionLabel>{label}</SectionLabel>
        {/* Nothing else on screen teaches exclude; one hint covers every
            chip. Hidden on touch, where alt-click does not exist. */}
        {hint && <SectionLabel>{hint}</SectionLabel>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  );
}

function Count({ value, negated, on }: { value: number; negated: boolean; on: boolean }) {
  return (
    <span
      style={{
        fontSize: text.xs,
        fontWeight: 600,
        color: 'inherit',
        opacity: on ? 0.85 : 0.6,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {negated ? `−${value.toLocaleString('en-US')}` : value.toLocaleString('en-US')}
    </span>
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
    // Bare `role="radio"` under the panel's group, deliberately NOT a
    // `radiogroup`: that role promises roving tabindex + arrow keys these
    // chips do not implement, and a checked one can be unchecked.
    <button
      type="button"
      role="radio"
      aria-checked={isActive || isNegated}
      // `aria-checked` alone can't tell "only active" from "not active",
      // and an `aria-label` REPLACES the computed name — so the count is
      // folded back in explicitly.
      aria-label={
        isNegated
          ? `Exclude ${bucket} senders${count !== undefined ? `, ${count.toLocaleString('en-US')} excluded` : ''}`
          : `Only ${bucket} senders${count !== undefined ? `, ${count.toLocaleString('en-US')}` : ''}`
      }
      title={`${ACTIVITY_BUCKET_TITLE[bucket]} · alt-click to exclude`}
      onClick={(e) => cycle(e.altKey)}
      onContextMenu={(e) => {
        e.preventDefault();
        cycle(true);
      }}
      style={chipStyle({ active: isActive, negated: isNegated })}
    >
      <span>{isNegated ? `not ${bucket}` : bucket}</span>
      {count !== undefined && (
        <Count value={count} negated={isNegated} on={isActive || isNegated} />
      )}
    </button>
  );
}

function ToggleChip({
  label,
  count,
  value,
  onChange,
  negatedHint,
}: {
  label: string;
  count: number | undefined;
  value: TriStateFilter;
  onChange: (next: TriStateFilter) => void;
  /**
   * The negated "has unsubscribe" reads as "confirmed none", but the
   * predicate is `unsubscribe_method IS NULL OR = 'none'` — NULL means
   * not checked yet. Lets that one chip's negated title say so.
   */
  negatedHint?: string;
}) {
  const active = value === true;
  const negated = value === false;

  const cycle = (e: MouseEvent | { altKey: boolean }) => {
    if (e.altKey) onChange(value === false ? null : false);
    else onChange(value === true ? null : true);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      onContextMenu={(e) => {
        e.preventDefault();
        cycle({ altKey: true });
      }}
      style={chipStyle({ active, negated })}
      // The visible "not" prefix is part of the label, but the count is
      // not — and an `aria-label` replaces the whole computed name.
      aria-pressed={active || negated}
      aria-label={
        (negated ? `Exclude: ${label}` : label) +
        (count !== undefined ? `, ${count.toLocaleString('en-US')}` : '')
      }
      title={negated ? (negatedHint ?? `Excluding ${label}`) : `${label} · alt-click to exclude`}
    >
      <span>{negated ? `not ${label}` : label}</span>
      {count !== undefined && <Count value={count} negated={negated} on={active || negated} />}
    </button>
  );
}

/**
 * Plain on/off chip (D51 "unsub'd, still emailing"). No negated third
 * state — the complement of "asked to stop but mail kept coming" isn't a
 * scope anyone composes.
 */
function OnOffChip({
  label,
  count,
  active,
  onToggle,
}: {
  label: string;
  count: number | undefined;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      style={chipStyle({ active, negated: false })}
    >
      <span>{label}</span>
      {count !== undefined && <Count value={count} negated={false} on={active} />}
    </button>
  );
}

// Included = filled ink. Excluded = an ink ring + a visible "not" — never
// colour alone, and never the danger hue (that is Delete's). At rest a
// quiet fill capsule, no outline.
function chipStyle({
  active,
  negated,
}: {
  active: boolean;
  negated: boolean;
}): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    padding: '0 12px',
    border: 'none',
    boxShadow: negated ? `inset 0 0 0 1.5px ${color.fg}` : undefined,
    borderRadius: radius.pill,
    background: active ? color.fg : negated ? 'transparent' : color.fill,
    color: active ? color.card : negated ? color.fg : color.fgSoft,
    fontFamily: font.sans,
    fontSize: text.sm,
    fontWeight: 500,
    cursor: 'pointer',
    transition: `background ${motion.fast} ${motion.ease}, color ${motion.fast} ${motion.ease}`,
    userSelect: 'none',
  };
}

/* ─── window ────────────────────────────────────────────────────── */

// "+" leads the number so it reads as a floor ("30+ days" = 30 or more).
const WINDOW_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'any time', value: null },
  { label: '30+ days', value: 30 },
  { label: '90+ days', value: 90 },
  { label: '6+ months', value: 180 },
  { label: '1+ year', value: 365 },
];

/* ─── domain ────────────────────────────────────────────────────── */

function DomainField({
  value,
  onChange,
  suggestions,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  suggestions: string[];
}) {
  const [draft, setDraft] = useState(value ?? '');
  const labelId = useId();
  const listId = useId();
  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);
  const commit = (raw: string) => {
    const trimmed = raw.trim().toLowerCase();
    const next = trimmed.length === 0 ? null : trimmed;
    if (next !== value) onChange(next);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionLabel id={labelId}>Domain</SectionLabel>
      <input
        value={draft}
        aria-labelledby={labelId}
        list={listId}
        onChange={(e) => {
          setDraft(e.target.value);
          // Picking a suggestion is a finished answer; typing is not.
          if (suggestions.includes(e.target.value)) commit(e.target.value);
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(draft);
        }}
        placeholder="amazon.com"
        style={FIELD_STYLE}
      />
      <datalist id={listId}>
        {suggestions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </div>
  );
}

/* ─── active filter chips ───────────────────────────────────────── */

interface ActiveChip {
  key: string;
  label: string;
  cleared: ComposeState;
}

function activeFilterChips(s: ComposeState): ActiveChip[] {
  const out: ActiveChip[] = [];
  if (s.activity !== null) {
    out.push({
      key: 'activity',
      label: s.activityNegate ? `Not ${s.activity}` : capitalize(s.activity),
      cleared: { ...s, activity: null, activityNegate: false },
    });
  }
  const tri = (key: 'unsubReady' | 'wroteTo' | 'protectedFlag', on: string, off: string): void => {
    if (s[key] === null) return;
    out.push({ key, label: s[key] ? on : off, cleared: { ...s, [key]: null } });
  };
  tri('unsubReady', 'Has unsubscribe', 'No unsubscribe');
  tri('wroteTo', 'You wrote to them', 'Never wrote to them');
  tri('protectedFlag', 'Protected', 'Not protected');
  if (s.unsubIgnored) {
    out.push({
      key: 'unsubIgnored',
      label: 'Unsubscribed, still emailing',
      cleared: { ...s, unsubIgnored: false },
    });
  }
  if (s.windowDays !== null) {
    const opt = WINDOW_OPTIONS.find((o) => o.value === s.windowDays);
    out.push({
      key: 'windowDays',
      label: `No email for ${opt?.label ?? `${s.windowDays}+ days`}`,
      cleared: { ...s, windowDays: null },
    });
  }
  if (s.domain !== null) {
    out.push({ key: 'domain', label: s.domain, cleared: { ...s, domain: null } });
  }
  return out;
}

const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * What is narrowing the list, as removable chips + `Clear`. Renders
 * NOTHING on the first-visit default — a pristine screen has no chip row.
 */
export function ActiveFilterChips({
  state,
  onChange,
  onClear,
}: {
  state: ComposeState;
  onChange: (next: ComposeState) => void;
  onClear: () => void;
}) {
  if (isDefaultCompose(state)) return null;
  const chips = activeFilterChips(state);
  if (chips.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Active filters"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}
    >
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          aria-label={`Remove filter: ${chip.label}`}
          onClick={() => onChange(chip.cleared)}
          style={{
            ...chipStyle({ active: false, negated: false }),
            paddingRight: 4,
            color: color.fg,
          }}
        >
          <span>{chip.label}</span>
          {/* The whole capsule removes; the × is its ghost-circle glyph. */}
          <span
            aria-hidden="true"
            style={{
              width: 24,
              height: 24,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              color: color.fgMuted,
              fontSize: text.md,
              lineHeight: 1,
            }}
          >
            ×
          </span>
        </button>
      ))}
      <button type="button" onClick={onClear} style={{ ...TEXT_BUTTON, marginLeft: 4 }}>
        Clear
      </button>
    </div>
  );
}

/* ─── sort ──────────────────────────────────────────────────────── */

type SortColumn = 'total' | 'last_seen' | 'first_seen' | 'name';

const SORT_OPTIONS: ReadonlyArray<{
  sort: SortColumn;
  direction: SenderListDirection;
  label: string;
  group: string;
}> = [
  // Unqualified on purpose. `senders.total_received` converges nightly
  // to COUNT(mail_messages) for the sender, so it is neither "ever" nor
  // a cumulative "seen" — it is what we currently hold.
  { sort: 'total', direction: 'desc', label: 'Most received', group: 'Volume' },
  { sort: 'total', direction: 'asc', label: 'Fewest received', group: 'Volume' },
  { sort: 'last_seen', direction: 'desc', label: 'Most recent', group: 'Last seen' },
  { sort: 'last_seen', direction: 'asc', label: 'Least recent', group: 'Last seen' },
  { sort: 'first_seen', direction: 'desc', label: 'Newest arrivals', group: 'First seen' },
  { sort: 'first_seen', direction: 'asc', label: 'Oldest arrivals', group: 'First seen' },
  { sort: 'name', direction: 'asc', label: 'A → Z', group: 'Name' },
  { sort: 'name', direction: 'desc', label: 'Z → A', group: 'Name' },
];

function activeSortLabel(sort: SenderListSort, direction: SenderListDirection): string {
  const match = SORT_OPTIONS.find((o) => o.sort === sort && o.direction === direction);
  return match?.label ?? `${sort} ${direction === 'desc' ? '↓' : '↑'}`;
}

/** `[Sort: Most received ▾]` — every (column × direction), grouped by column. */
export function SortMenu({
  sort,
  direction,
  onChange,
}: {
  sort: SenderListSort;
  direction: SenderListDirection;
  onChange: (next: { sort: SenderListSort; direction: SenderListDirection }) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  const groups = new Map<string, (typeof SORT_OPTIONS)[number][]>();
  for (const opt of SORT_OPTIONS) groups.set(opt.group, [...(groups.get(opt.group) ?? []), opt]);
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="dm-hdr-btn"
        style={headerButtonStyle(false)}
      >
        <span style={{ color: color.fgMuted }}>Sort:</span>
        {activeSortLabel(sort, direction)}
        {CARET}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Sort senders"
          className="dm-menu"
          style={{ ...POPOVER_STYLE, minWidth: 220, padding: 6 }}
        >
          {[...groups].map(([groupLabel, options]) => (
            <div key={groupLabel}>
              <div style={{ padding: '10px 12px 4px' }}>
                <SectionLabel>{groupLabel}</SectionLabel>
              </div>
              {options.map((opt) => {
                const active = opt.sort === sort && opt.direction === direction;
                return (
                  <button
                    key={`${opt.sort}-${opt.direction}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      onChange({ sort: opt.sort, direction: opt.direction });
                      setOpen(false);
                    }}
                    className="dm-menu-row"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      height: 40,
                      padding: '0 12px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: radius.md,
                      cursor: 'pointer',
                      fontFamily: font.sans,
                      fontSize: text.base,
                      fontWeight: active ? 600 : 400,
                      color: color.fg,
                      textAlign: 'left',
                    }}
                  >
                    <span
                      aria-hidden
                      style={{ width: 14, color: active ? color.primary : 'transparent' }}
                    >
                      ✓
                    </span>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

/* ─── saved views (D51) ─────────────────────────────────────────── */

/**
 * Host wiring for saved views. The panel renders NAMES only — the host
 * (senders-screen) owns the full view objects, the `users.preferences`
 * round-trip, and applying a view's filters + sort. The cap is enforced
 * server-side; `capReached` mirrors it so the save field explains itself
 * instead of failing.
 */
export interface SavedViewsProps {
  /** Saved view names, in stored order. */
  names: string[];
  /** Apply the named view's filters + sort. */
  onApply: (name: string) => void;
  /** Persist the CURRENT filters + sort under `name`. */
  onSave: (name: string) => void;
  /** Remove the named view. */
  onDelete: (name: string) => void;
  /** True when the current compose has at least one active axis. */
  canSaveCurrent: boolean;
  /** True at the cap — the save field is disabled and says why. */
  capReached: boolean;
  /**
   * True while a save/delete PATCH is in flight. The mutation is a plain
   * full-replace with no serialization — a second write built from a
   * stale snapshot can resurrect a view just deleted. Disabling the
   * mutating controls makes that race unreachable from the UI.
   */
  mutating?: boolean;
}

function SavedViews({
  names,
  onApply,
  onSave,
  onDelete,
  canSaveCurrent,
  capReached,
  mutating = false,
}: SavedViewsProps) {
  const [draft, setDraft] = useState('');
  // Arm-then-confirm: a delete is irreversible and sits beside Apply. The
  // first click arms ("Delete?"); a second click on that SAME button deletes.
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const saveDisabled = capReached || draft.trim().length === 0 || mutating;

  const saveDraft = () => {
    const name = draft.trim();
    if (saveDisabled) return;
    onSave(name);
    setDraft('');
  };

  if (names.length === 0 && !canSaveCurrent) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionLabel>Saved views</SectionLabel>
      {names.map((name) => (
        <span key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => onApply(name)}
            style={{
              ...TEXT_BUTTON,
              flex: 1,
              minWidth: 0,
              color: color.fg,
              fontSize: text.base,
              textAlign: 'left',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </button>
          <button
            type="button"
            aria-label={
              armedDelete === name ? `Confirm delete view ${name}` : `Delete view ${name}`
            }
            disabled={mutating}
            onClick={() => {
              if (armedDelete === name) {
                onDelete(name);
                setArmedDelete(null);
              } else {
                setArmedDelete(name);
              }
            }}
            style={{
              ...TEXT_BUTTON,
              minWidth: 32,
              minHeight: 32,
              flex: '0 0 auto',
              opacity: mutating ? 0.5 : 1,
              cursor: mutating ? 'default' : 'pointer',
              color: armedDelete === name ? color.danger : color.fgMuted,
            }}
          >
            {armedDelete === name ? 'Delete?' : '×'}
          </button>
        </span>
      ))}
      {canSaveCurrent && (
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveDraft();
            }}
            placeholder={capReached ? 'Delete a view to save another' : 'Name this view…'}
            disabled={capReached}
            aria-label="New view name"
            style={{ ...FIELD_STYLE, flex: 1, minWidth: 0 }}
          />
          <button
            type="button"
            onClick={saveDraft}
            disabled={saveDisabled}
            style={{
              ...TEXT_BUTTON,
              color: saveDisabled ? color.fgMuted : color.primary,
              cursor: saveDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            Save
          </button>
        </span>
      )}
    </div>
  );
}
