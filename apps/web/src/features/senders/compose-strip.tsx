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
 *   • You-wrote-to-them toggle (tri-state)
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

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { tokens, useIsAtMost } from '@declutrmail/shared';
import { WINDOWS } from '@declutrmail/shared/senders';
import type {
  ActivityBucket,
  SenderListDirection,
  SenderListSort,
  TriStateFilter,
} from '@/lib/api/senders';

// QA-senders-20260901-04: the active/quiet/dormant thresholds these chips
// filter by were stated nowhere on screen. Mirrors the exact cutoffs
// `filterCountsQuery` uses (senders.read-service.ts) — active/dormant ride
// the shared WINDOWS constants directly; "quiet" is everything between,
// which WINDOWS has no single constant for.
const ACTIVITY_BUCKET_TITLE: Record<ActivityBucket, string> = {
  active: `Last email within ${WINDOWS.ACTIVE_DAYS} days`,
  // Codex round-1 review: "30–180 days ago" overlapped Active's own
  // inclusive 30-day boundary — a sender last seen exactly 30 days ago
  // reads as Active, not Quiet.
  quiet: `Last email more than ${WINDOWS.ACTIVE_DAYS} and up to ${WINDOWS.DORMANT_DAYS} days ago`,
  dormant: `Last email over ${WINDOWS.DORMANT_DAYS} days ago`,
};

const { color, font } = tokens;

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
 * `EMPTY_COMPOSE` remains what "Clear filters" resolves to.
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
  /** D51 — "unsub'd, still emailing" axis count. May be undefined on
   *  older wire payloads; the chip then renders without a count. */
  unsubIgnored?: number | undefined;
}

export function ComposeStrip({
  state,
  counts,
  updating = false,
  onChange,
  onClear,
  domainSuggestions,
  sort,
  direction,
  onSortChange,
  views,
}: {
  state: ComposeState;
  /** Mailbox-wide absolute counts per axis. May be undefined while loading. */
  counts: ComposeCounts | undefined;
  /**
   * QA-senders-20260901-01 — true while `counts` may be one response
   * behind (an in-flight refetch of the active query). Marks the strip
   * `aria-busy`; the chips themselves stay clickable and their counts do
   * NOT dim (see the `aria-busy` test below for why — a whole-strip dim
   * used to compound with an already-dimmed inactive chip's own count
   * span). `SenderResultsFreshness` (senders-screen.tsx) renders the
   * visible "Updating results…" status text for this state.
   */
  updating?: boolean;
  onChange: (next: ComposeState) => void;
  onClear: () => void;
  /** Active sort column — surfaced as a Sort chip alongside the filter axes. */
  sort: SenderListSort;
  direction: SenderListDirection;
  onSortChange: (next: { sort: SenderListSort; direction: SenderListDirection }) => void;
  /** Up to ~6 top domains for the popover quick-pick. */
  domainSuggestions: string[];
  /**
   * D51 saved filter views — host-supplied wiring for the Views menu.
   * Omitted = menu hidden (bare renders / stories that don't exercise
   * persistence). Names only; the host owns the full view objects.
   */
  views?: ViewsMenuProps | undefined;
}) {
  const isTouch = useIsAtMost('xs');
  return (
    <div
      role="group"
      aria-label="Filter and sort senders"
      aria-busy={updating}
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
      {/* Codex round-2 review of QA-senders-20260901-07: a `radiogroup`
          wrapper (round-1's fix) implies an ARIA interaction contract
          (roving tabindex, arrow-key nav) these chips don't implement,
          and clicking an already-checked one unchecks it — not real
          radio behaviour. A `radiogroup` that doesn't honour that
          contract is worse than none. Reverted to bare `role="radio"`
          chips (pre-existing) under the strip's own `role="group"`;
          the underlying interaction-model gap is flagged as its own
          QA candidate, not fixed here. */}
      <ActivityChip bucket="active" state={state} count={counts?.active} onChange={onChange} />
      <ActivityChip bucket="quiet" state={state} count={counts?.quiet} onChange={onChange} />
      <ActivityChip bucket="dormant" state={state} count={counts?.dormant} onChange={onChange} />
      {/* QA-senders-filtering-20260901-02: nothing on screen previously
          taught alt-click/right-click-to-exclude — one hint, once, covers
          every chip in the strip rather than repeating per-chip. Hidden on
          touch (design-system-agent PR #707 review): alt-click doesn't
          exist as a gesture there, so the hint would name something the
          reader can't do. */}
      {!isTouch && (
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            color: color.fgMuted,
            marginRight: 2,
          }}
        >
          (alt-click a chip to exclude it)
        </span>
      )}

      <Divider />

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

      <Divider />

      <SortChip sort={sort} direction={direction} onChange={onSortChange} />

      {views && (
        <>
          <Divider />
          <ViewsMenu {...views} />
        </>
      )}

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
      // QA-senders-filtering-20260901-02: `aria-checked` alone can't
      // distinguish "only active" from "not active" — both read
      // "checked". A screen reader needs the label to say which.
      // Codex round-1 review: an `aria-label` REPLACES the whole
      // accessible name computed from visible text — the first version
      // of this fix silently dropped the count the un-labelled button
      // used to announce (e.g. "active 508"). Folded back in explicitly.
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
      {/* Sighted users get the same ambiguity fixed visually: a negated
          chip used to show the identical label+count as an included one,
          with only background color telling them apart. */}
      <span>{isNegated ? `not ${bucket}` : bucket}</span>
      {count !== undefined && (
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 11,
            color: 'inherit',
            opacity: isActive || isNegated ? 0.85 : 0.6,
          }}
        >
          {isNegated ? `−${count.toLocaleString('en-US')}` : count.toLocaleString('en-US')}
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
  negatedHint,
}: {
  label: string;
  count: number | undefined;
  value: TriStateFilter;
  onChange: (next: TriStateFilter) => void;
  /**
   * QA-senders-filtering-20260901-03: the negated state of "has
   * unsubscribe" reads as "confirmed none" but the predicate is
   * `unsubscribe_method IS NULL OR = 'none'` — NULL means the sender
   * hasn't been checked yet (`senders.ts` schema doc), not that it was
   * checked and found absent. Lets one chip's negated title say so
   * without a generic title-override API nobody else needs yet.
   */
  negatedHint?: string;
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
      // QA-senders-filtering-20260901-02: the ✓/✕ glyph below is
      // aria-hidden, so a screen reader previously announced only
      // `label`, identically whether included or excluded — same gap
      // as `ActivityChip`, same fix. Codex round-1 review: an
      // `aria-label` replaces the WHOLE computed accessible name, so
      // this dropped the count in all three states (not just the two
      // named in the original fix) — folded back in explicitly.
      aria-pressed={active || negated}
      aria-label={
        (negated ? `Exclude: ${label}` : label) +
        (count !== undefined ? `, ${count.toLocaleString('en-US')}` : '')
      }
      title={negated ? (negatedHint ?? `Excluding ${label}`) : `${label} · alt-click to exclude`}
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
        {active && <span style={{ color: color.fg, lineHeight: 1, fontSize: 9 }}>✓</span>}
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
          {negated ? `−${count.toLocaleString('en-US')}` : count.toLocaleString('en-US')}
        </span>
      )}
    </button>
  );
}

/**
 * Plain on/off chip (D51 "unsub'd, still emailing"). Unlike `ToggleChip`
 * there is no negated third state — the complement of "asked to stop but
 * mail kept coming" isn't a scope anyone composes.
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
      style={chipStyle({ active, negated: false, withCheckbox: true })}
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
        {active && <span style={{ color: color.fg, lineHeight: 1, fontSize: 9 }}>✓</span>}
      </span>
      <span>{label}</span>
      {count !== undefined && (
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 11,
            color: 'inherit',
            opacity: active ? 0.85 : 0.6,
          }}
        >
          {count.toLocaleString('en-US')}
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
  const bg = active ? color.fg : negated ? color.dangerBg : color.card;
  const fg = active ? color.card : negated ? color.danger : color.fgSoft;
  const border = active ? color.fg : negated ? color.dangerBorder : color.line;
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

// QA-senders-filtering-20260901-04: "+" moved to the front of the number
// so it reads as a floor ("30+ days" = 30 or more) rather than looking
// like arithmetic tacked onto the unit ("30 days+").
const WINDOW_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'any time', value: null },
  { label: '30+ days', value: 30 },
  { label: '90+ days', value: 90 },
  { label: '6+ months', value: 180 },
  { label: '1+ year', value: 365 },
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
        {/* QA-senders-filtering-20260901-04: "quiet for" was one of THREE
            different meanings of "quiet" on this one toolbar — the
            `quiet` Activity chip (a bounded 30-180d bucket), this
            open-ended Nd+ floor, and the "Longest quiet" sort direction.
            "no email for" doesn't collide with the other two. */}
        <AxisLabel>no email for</AxisLabel>
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
  // Focus/select ONLY on open. Must not share the listener effect below:
  // its deps include `draft`, so it re-runs per keystroke — a select()
  // there highlights the whole input after every key and the next key
  // replaces it ("can only type one letter", founder-reported 2026-07-04).
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);
  useEffect(() => {
    if (!open) return;
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
  }, [open, draft, value, onChange]);
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
  const ref = useRef<HTMLSpanElement>(null);
  // QA-senders-filtering-20260901-08, Codex round-1 review: a blind
  // `right: 0` only fixes overflow past the RIGHT edge — a chip near
  // the LEFT edge (common once the strip wraps at 375px) opens a
  // right-anchored 220px popover that runs off the LEFT edge instead,
  // and nothing here ever checked the BOTTOM edge. Measures its own
  // rendered position once and clamps whichever edges actually
  // overflow.
  //
  // Codex round-2 review, known remaining gap (not fixed — see below):
  // measuring once on mount misses content that grows AFTER mount
  // while the same popover instance stays open — Domain's suggestion
  // list as the draft changes, or Views' saved-view list once a fetch
  // resolves after the menu was already opened. A short popover could
  // pass the bottom-edge check at open time, then grow past it with no
  // remeasurement. A `ResizeObserver` re-running this same clamp on
  // every size change would close this, but doing that safely needs
  // the flip decision anchored to the TRIGGER's stable position (this
  // component's `ref` is on the popover itself, which the flip already
  // repositions — recomputing from ITS OWN rect on every resize risks
  // oscillating between the two states) — a real fix, not attempted
  // here without a further review pass to catch that class of mistake.
  const [edgeFix, setEdgeFix] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fix: React.CSSProperties = {};
    if (rect.left < 8) {
      fix.left = 0;
      fix.right = 'auto';
    }
    if (rect.bottom > window.innerHeight - 8) {
      fix.top = 'auto';
      fix.bottom = 'calc(100% + 8px)';
      // Codex round-2 review: flipping to open ABOVE the trigger used
      // the same full-viewport `maxHeight` as the un-flipped case,
      // which only bounds the popover's OWN size — nothing stopped a
      // popover taller than the space actually available above a
      // trigger sitting near the top of a short viewport from pushing
      // past `top: 0` regardless. Cap it to the space that's really
      // there (trigger's own top edge, minus the 8px gap, minus an 8px
      // margin) instead of the whole viewport, so the flipped popover
      // physically cannot extend above the visible area — content that
      // doesn't fit scrolls via the existing `overflowY: auto`.
      const availableAbove = rect.top - 8 - 8;
      fix.maxHeight = Math.max(80, availableAbove);
    }
    setEdgeFix(fix);
  }, []);
  return (
    <span
      ref={ref}
      role="menu"
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        zIndex: 60,
        minWidth: 'min(220px, calc(100vw - 32px))',
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 32px)',
        overflowY: 'auto',
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 9,
        boxShadow: '0 16px 44px rgba(14,20,19,0.16)',
        padding: 6,
        display: 'block',
        fontFamily: font.sans,
        ...edgeFix,
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

/* ─── sort chip ─────────────────────────────────────────────────── */

type GridSortColumn = 'total' | 'last_seen' | 'first_seen' | 'name';

const SORT_OPTIONS: ReadonlyArray<{
  sort: GridSortColumn;
  direction: SenderListDirection;
  label: string;
  group: string;
}> = [
  // Unqualified on purpose. `senders.total_received` converges nightly
  // to COUNT(mail_messages) for the sender (SendersCounterReconciliation
  // worker), so it is neither "ever" nor a cumulative "seen" — it is
  // what we currently hold. This group has no competing option, so the
  // sort needs no scope word at all (findings doc 7).
  { sort: 'total', direction: 'desc', label: 'Most received', group: 'Volume' },
  { sort: 'total', direction: 'asc', label: 'Fewest received', group: 'Volume' },
  { sort: 'last_seen', direction: 'desc', label: 'Most recent', group: 'Last seen' },
  // QA-senders-filtering-20260901-04: was "Longest quiet" — a third,
  // unrelated meaning of "quiet" sharing this toolbar with the Activity
  // chip and the "no email for" window. This is a sort DIRECTION, not a
  // bucket.
  { sort: 'last_seen', direction: 'asc', label: 'Least recent', group: 'Last seen' },
  { sort: 'first_seen', direction: 'desc', label: 'Newest arrivals', group: 'First seen' },
  { sort: 'first_seen', direction: 'asc', label: 'Oldest arrivals', group: 'First seen' },
  { sort: 'name', direction: 'asc', label: 'A → Z', group: 'Name' },
  { sort: 'name', direction: 'desc', label: 'Z → A', group: 'Name' },
];

const COLUMN_FALLBACK_LABEL: Record<GridSortColumn, string> = {
  total: 'volume',
  last_seen: 'last seen',
  first_seen: 'first seen',
  name: 'name',
};

function activeSortLabel(sort: SenderListSort, direction: SenderListDirection): string {
  const match = SORT_OPTIONS.find((o) => o.sort === sort && o.direction === direction);
  if (match) return match.label;
  const colLabel = (COLUMN_FALLBACK_LABEL as Record<string, string>)[sort] ?? sort;
  return `${colLabel} ${direction === 'desc' ? '↓' : '↑'}`;
}

/**
 * Sort chip — popover that lists every (column × direction) option
 * grouped by column. Rides the same affordance shape as Window /
 * Domain so the user reads the row as one strip ("filter / sort
 * compose"), not "filters … then sort somewhere else".
 */
function SortChip({
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
  const groups = SORT_OPTIONS.reduce<Record<string, (typeof SORT_OPTIONS)[number][]>>(
    (acc, opt) => {
      const arr = acc[opt.group] ?? [];
      arr.push(opt);
      acc[opt.group] = arr;
      return acc;
    },
    {},
  );
  // Sort is ALWAYS active (there's always SOME ordering). Render the
  // chip in the same neutral default state as Window/Domain when the
  // chosen sort matches the BE default `total ↓`; mark "active" once
  // the user has picked anything else.
  const isCustomSort = !(sort === 'total' && direction === 'desc');
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ ...chipStyle({ active: isCustomSort, negated: false }), gap: 4 }}
      >
        <AxisLabel>sort</AxisLabel>
        <span>{activeSortLabel(sort, direction)}</span>
        <span style={{ fontSize: 9, color: color.fgMuted, marginLeft: 2 }}>▾</span>
      </button>
      {open && (
        <Popover>
          {Object.entries(groups).map(([groupLabel, options]) => (
            <span key={groupLabel} style={{ display: 'block' }}>
              <span
                style={{
                  display: 'block',
                  padding: '6px 10px 2px',
                  fontFamily: font.mono,
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  color: color.fgMuted,
                  textTransform: 'uppercase',
                }}
              >
                {groupLabel}
              </span>
              {options.map((opt) => {
                const active = opt.sort === sort && opt.direction === direction;
                return (
                  <PopoverItem
                    key={`${opt.sort}-${opt.direction}`}
                    active={active}
                    onClick={() => {
                      onChange({ sort: opt.sort, direction: opt.direction });
                      setOpen(false);
                    }}
                  >
                    {opt.label}
                  </PopoverItem>
                );
              })}
            </span>
          ))}
        </Popover>
      )}
    </span>
  );
}

/* ─── saved views menu (D51) ────────────────────────────────────── */

/**
 * Host wiring for the Views menu. The strip renders NAMES only — the
 * host (senders-screen) owns the full saved-view objects, the
 * `users.preferences` persistence round-trip, and the compose/sort
 * application on pick. Cap enforcement (10 views) is server-side; the
 * `capReached` flag mirrors it so the save affordance explains itself
 * instead of failing.
 */
export interface ViewsMenuProps {
  /** Saved view names, in stored order. */
  names: string[];
  /** Apply the named view's compose + sort. */
  onApply: (name: string) => void;
  /** Persist the CURRENT compose + sort under `name`. */
  onSave: (name: string) => void;
  /** Remove the named view. */
  onDelete: (name: string) => void;
  /** True when the current compose has at least one active axis. */
  canSaveCurrent: boolean;
  /** True at the 10-view cap — save affordance disabled with copy. */
  capReached: boolean;
  /**
   * True while a save/delete PATCH is in flight. Codex round-2 review:
   * the underlying mutation (`useSaveSenderViews`) is a plain
   * full-replace write with no serialization — building the next
   * payload from a stale `savedViews` snapshot if a second write fires
   * before the first resolves can resurrect a view just deleted, or
   * lose an unrelated change. Disabling the mutating controls while
   * one write is in flight makes that race unreachable from the UI
   * without touching the mutation hook itself.
   */
  mutating?: boolean;
}

/**
 * `ViewsMenu` — persist named ComposeStrip filter combinations (D51;
 * spec v1.2 Decision 4's "Saved filters" resurrection). Same popover
 * affordance shape as Window / Domain / Sort so the strip reads as one
 * compose row.
 */
function ViewsMenu({
  names,
  onApply,
  onSave,
  onDelete,
  canSaveCurrent,
  capReached,
  mutating = false,
}: ViewsMenuProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  // Codex round-1 review of QA-senders-filtering-20260901-06: a bigger
  // hit target plus a toast made an irreversible delete more visible,
  // not less accidental — the click itself was still one click, same
  // as before. Arm-then-confirm: the first click on a view's `×` marks
  // it armed (the button becomes an explicit "Delete?"); a second click
  // on that SAME button, or the menu closing/reopening, is what it
  // takes to actually delete.
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    setDraft('');
    setArmedDelete(null);
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

  const saveDraft = () => {
    const name = draft.trim();
    if (name.length === 0 || capReached || mutating) return;
    onSave(name);
    setDraft('');
  };

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ ...chipStyle({ active: false, negated: false }), gap: 4 }}
      >
        <AxisLabel>views</AxisLabel>
        <span>{names.length > 0 ? String(names.length) : 'none'}</span>
        <span style={{ fontSize: 9, color: color.fgMuted, marginLeft: 2 }}>▾</span>
      </button>
      {open && (
        <Popover>
          {names.length === 0 && (
            <span
              style={{
                display: 'block',
                padding: '7px 10px',
                fontFamily: font.sans,
                fontSize: 12.5,
                color: color.fgMuted,
              }}
            >
              {/* QA-senders-filtering-20260901-06: taught nothing — a
                  user opening this menu with no filters set had no path
                  forward, since the save row below only appears once
                  `canSaveCurrent` is true. Codex round-1 review: the
                  first version of this fix ALWAYS said "set a filter",
                  even when one was already set (the default 'active'
                  chip makes `canSaveCurrent` true from a pristine URL)
                  — telling the user to do the one thing they'd already
                  done, right above the input that proves it. */}
              {canSaveCurrent
                ? 'No saved views yet.'
                : 'No saved views yet — set a filter, then save it here.'}
            </span>
          )}
          {names.map((name) => (
            <span key={name} style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <PopoverItem
                  active={false}
                  onClick={() => {
                    onApply(name);
                    setOpen(false);
                  }}
                >
                  {name}
                </PopoverItem>
              </span>
              <button
                type="button"
                aria-label={
                  armedDelete === name ? `Confirm delete view ${name}` : `Delete view ${name}`
                }
                // QA-senders-filtering-20260901-06: was `padding: '0 8px'`
                // with no explicit height — an ~12px-tall hit target
                // immediately beside the row that applies the view.
                //
                // Codex round-2 review: `disabled` while a write is in
                // flight closes the rapid-double-delete race described
                // on `mutating` above, purely by making a second click
                // unreachable until the first PATCH has settled.
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
                  background: 'transparent',
                  border: armedDelete === name ? `1px solid ${color.danger}` : 'none',
                  borderRadius: 6,
                  cursor: mutating ? 'default' : 'pointer',
                  opacity: mutating ? 0.5 : 1,
                  color: armedDelete === name ? color.danger : color.fgMuted,
                  fontFamily: font.sans,
                  fontSize: armedDelete === name ? 11 : 12,
                  fontWeight: armedDelete === name ? 600 : 400,
                  minWidth: 32,
                  minHeight: 32,
                  padding: armedDelete === name ? '0 8px' : 0,
                  flex: '0 0 auto',
                }}
              >
                {armedDelete === name ? 'Delete?' : '×'}
              </button>
            </span>
          ))}
          {/* Save-current row — only when the compose has something to save. */}
          {canSaveCurrent && (
            <span
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                borderTop: `1px solid ${color.line}`,
                marginTop: 6,
                paddingTop: 6,
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveDraft();
                }}
                // QA-senders-filtering-20260901-09: "cap" is schema
                // vocabulary; also, this and the toast in
                // senders-screen.tsx now both derive from the one shared
                // `SENDER_VIEWS_CAP` constant instead of two.
                placeholder={capReached ? 'Delete a view to save another' : 'Name this view…'}
                disabled={capReached}
                aria-label="New view name"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '6px 8px',
                  fontFamily: font.mono,
                  fontSize: 12,
                  border: `1px solid ${color.line}`,
                  borderRadius: 6,
                  background: color.paper,
                  color: color.fg,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={saveDraft}
                // Codex round-2 review: same in-flight-write guard as the
                // Delete button above, on the OTHER mutating action this
                // menu offers.
                disabled={capReached || draft.trim().length === 0 || mutating}
                style={{
                  fontFamily: font.mono,
                  fontSize: 11,
                  letterSpacing: '0.04em',
                  color:
                    capReached || draft.trim().length === 0 || mutating
                      ? color.fgMuted
                      : 'var(--color-amber)',
                  background: 'transparent',
                  border: 'none',
                  padding: '0 4px',
                  cursor:
                    capReached || draft.trim().length === 0 || mutating ? 'not-allowed' : 'pointer',
                }}
              >
                save
              </button>
            </span>
          )}
        </Popover>
      )}
    </span>
  );
}
