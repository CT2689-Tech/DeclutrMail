// apps/web/src/app/senders-lab-v2/page.tsx
//
// THROWAWAY VISUAL LAB — "The Reading Room" prototype for the Senders
// top-of-screen redesign (Statement Bar / Option A++).
//
// Replaces the 4 competing strips (search · KPI · fact-chips · result-
// count) with ONE editorial sentence + one hero number. The sentence is
// composed of click-to-edit tokens — each token is a dotted-underlined
// word that opens an inline popover of options. Picking an option
// reflows the sentence and rolls the hero count to the new value.
//
// Mock data. No BE. Self-contained route. Founder reviews the *feel*
// before we plumb the BE filter params + harden to /senders.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

// ─── PALETTE ───
// Single-accent ink-on-paper. Geist + Fraunces. The number is the only
// chromatic moment; everything else lives in fg / fgSoft / fgMuted.
const C = {
  paper: '#FBFAF6',
  paperGrid: '#F3F1EA',
  ink: '#0E1413',
  inkSoft: 'rgba(14,20,19,0.66)',
  inkMuted: 'rgba(14,20,19,0.36)',
  inkFaint: 'rgba(14,20,19,0.14)',
  accent: '#0E1413',
  amber: '#B4530D',
  emerald: '#1E7C5A',
  card: '#FFFFFF',
  line: 'rgba(14,20,19,0.10)',
} as const;

const FONT_BODY = '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const FONT_MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const FONT_EDITORIAL = '"Fraunces", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

// ────────────────────────────────────────────────────────────────────
// Mock data — small but realistic spread.
// ────────────────────────────────────────────────────────────────────

type Sender = {
  id: string;
  name: string;
  domain: string;
  total: number;
  monthly: number;
  lastSeenDays: number;
  replied: number;
  protectedFlag: boolean;
  unsubReady: boolean;
};

const SENDERS: Sender[] = [
  {
    id: 's1',
    name: 'Amazon.com',
    domain: 'amazon.com',
    total: 555,
    monthly: 0,
    lastSeenDays: 534,
    replied: 0,
    protectedFlag: false,
    unsubReady: true,
  },
  {
    id: 's2',
    name: 'return@amazon.com',
    domain: 'amazon.com',
    total: 421,
    monthly: 0,
    lastSeenDays: 380,
    replied: 0,
    protectedFlag: false,
    unsubReady: true,
  },
  {
    id: 's3',
    name: 'Amazon.com (orders)',
    domain: 'amazon.com',
    total: 439,
    monthly: 12,
    lastSeenDays: 2,
    replied: 0,
    protectedFlag: false,
    unsubReady: false,
  },
  {
    id: 's4',
    name: 'LinkedIn',
    domain: 'linkedin.com',
    total: 312,
    monthly: 47,
    lastSeenDays: 1,
    replied: 0,
    protectedFlag: false,
    unsubReady: true,
  },
  {
    id: 's5',
    name: 'Bank of America',
    domain: 'bankofamerica.com',
    total: 54,
    monthly: 4,
    lastSeenDays: 3,
    replied: 0,
    protectedFlag: true,
    unsubReady: false,
  },
  {
    id: 's6',
    name: 'Substack',
    domain: 'substack.com',
    total: 87,
    monthly: 18,
    lastSeenDays: 4,
    replied: 0,
    protectedFlag: false,
    unsubReady: true,
  },
  {
    id: 's7',
    name: 'Etherscan',
    domain: 'etherscan.io',
    total: 240,
    monthly: 44,
    lastSeenDays: 7,
    replied: 0,
    protectedFlag: false,
    unsubReady: true,
  },
  {
    id: 's8',
    name: 'Sarah Chen',
    domain: 'google.com',
    total: 89,
    monthly: 17,
    lastSeenDays: 0,
    replied: 12,
    protectedFlag: false,
    unsubReady: false,
  },
  {
    id: 's9',
    name: 'Marcus Kelly',
    domain: 'company.io',
    total: 64,
    monthly: 9,
    lastSeenDays: 1,
    replied: 8,
    protectedFlag: false,
    unsubReady: false,
  },
  {
    id: 's10',
    name: 'GitHub',
    domain: 'github.com',
    total: 198,
    monthly: 24,
    lastSeenDays: 3,
    replied: 0,
    protectedFlag: false,
    unsubReady: true,
  },
  {
    id: 's11',
    name: 'Stripe',
    domain: 'stripe.com',
    total: 76,
    monthly: 6,
    lastSeenDays: 12,
    replied: 0,
    protectedFlag: true,
    unsubReady: false,
  },
  {
    id: 's12',
    name: 'Old Navy',
    domain: 'oldnavy.com',
    total: 412,
    monthly: 48,
    lastSeenDays: 0,
    replied: 0,
    protectedFlag: false,
    unsubReady: true,
  },
  {
    id: 's13',
    name: 'Robinhood',
    domain: 'robinhood.com',
    total: 154,
    monthly: 30,
    lastSeenDays: 3,
    replied: 0,
    protectedFlag: false,
    unsubReady: true,
  },
  {
    id: 's14',
    name: 'HDFC InstaAlerts',
    domain: 'hdfcbank.net',
    total: 87,
    monthly: 0,
    lastSeenDays: 62,
    replied: 0,
    protectedFlag: true,
    unsubReady: false,
  },
  {
    id: 's15',
    name: 'Notion',
    domain: 'notion.so',
    total: 145,
    monthly: 22,
    lastSeenDays: 2,
    replied: 0,
    protectedFlag: false,
    unsubReady: true,
  },
  {
    id: 's16',
    name: 'Calendly',
    domain: 'calendly.com',
    total: 67,
    monthly: 8,
    lastSeenDays: 5,
    replied: 0,
    protectedFlag: false,
    unsubReady: true,
  },
  {
    id: 's17',
    name: 'Medium Daily',
    domain: 'medium.com',
    total: 234,
    monthly: 60,
    lastSeenDays: 0,
    replied: 0,
    protectedFlag: false,
    unsubReady: true,
  },
  {
    id: 's18',
    name: 'Groupon',
    domain: 'groupon.com',
    total: 678,
    monthly: 52,
    lastSeenDays: 0,
    replied: 0,
    protectedFlag: false,
    unsubReady: true,
  },
  {
    id: 's19',
    name: 'Uber Support',
    domain: 'uber.com',
    total: 12,
    monthly: 0,
    lastSeenDays: 1683,
    replied: 0,
    protectedFlag: false,
    unsubReady: false,
  },
  {
    id: 's20',
    name: 'WORX',
    domain: 'worxtools.com',
    total: 4,
    monthly: 0,
    lastSeenDays: 1444,
    replied: 0,
    protectedFlag: false,
    unsubReady: false,
  },
  {
    id: 's21',
    name: 'Datawind',
    domain: 'datawind.com',
    total: 3,
    monthly: 0,
    lastSeenDays: 5268,
    replied: 0,
    protectedFlag: false,
    unsubReady: false,
  },
  {
    id: 's22',
    name: 'Dell',
    domain: 'dell.com',
    total: 47,
    monthly: 0,
    lastSeenDays: 3020,
    replied: 0,
    protectedFlag: false,
    unsubReady: false,
  },
  {
    id: 's23',
    name: 'Priya Raman',
    domain: 'hey.com',
    total: 78,
    monthly: 6,
    lastSeenDays: 2,
    replied: 14,
    protectedFlag: false,
    unsubReady: false,
  },
  {
    id: 's24',
    name: 'no-reply@amazon.com',
    domain: 'amazon.com',
    total: 155,
    monthly: 0,
    lastSeenDays: 638,
    replied: 0,
    protectedFlag: false,
    unsubReady: true,
  },
  {
    id: 's25',
    name: 'cs-reply@amazon.com',
    domain: 'amazon.com',
    total: 93,
    monthly: 0,
    lastSeenDays: 534,
    replied: 0,
    protectedFlag: false,
    unsubReady: false,
  },
];

const TOTAL_MAILBOX = 7759; // illustrative whole-mailbox total

// ────────────────────────────────────────────────────────────────────
// Token model.
// ────────────────────────────────────────────────────────────────────

type FilterKey =
  | 'everyone'
  | 'unsub_ready'
  | 'active'
  | 'quiet'
  | 'dormant'
  | 'replied'
  | 'protected';

type SortKey = 'most_total' | 'fewest_total' | 'recent' | 'longest_quiet' | 'name_az' | 'name_za';

type TimeWindowKey = 'all' | '30d' | '90d' | '180d' | '365d';

type Sentence = {
  filter: FilterKey;
  domain: string | null;
  window: TimeWindowKey;
  sort: SortKey;
};

const FILTER_LABEL: Record<FilterKey, string> = {
  everyone: 'everyone',
  unsub_ready: 'unsubscribe-ready',
  active: 'active',
  quiet: 'quiet',
  dormant: 'dormant',
  replied: "people I've replied to",
  protected: 'protected',
};

const SORT_LABEL: Record<SortKey, string> = {
  most_total: 'biggest first',
  fewest_total: 'smallest first',
  recent: 'most recent first',
  longest_quiet: 'longest quiet first',
  name_az: 'A → Z',
  name_za: 'Z → A',
};

const WINDOW_LABEL: Record<TimeWindowKey, string> = {
  all: 'any time',
  '30d': 'quiet for 30 days+',
  '90d': 'quiet for 90 days+',
  '180d': 'quiet for 6 months+',
  '365d': 'quiet for a year+',
};

// ────────────────────────────────────────────────────────────────────
// Saved sentences (preset views the founder might keep).
// ────────────────────────────────────────────────────────────────────

const SAVED: Array<{ name: string; sentence: Sentence }> = [
  {
    name: 'cleanup candidates',
    sentence: { filter: 'unsub_ready', domain: null, window: '90d', sort: 'most_total' },
  },
  {
    name: 'people I know',
    sentence: { filter: 'replied', domain: null, window: 'all', sort: 'recent' },
  },
  {
    name: 'amazon variants',
    sentence: { filter: 'everyone', domain: 'amazon.com', window: 'all', sort: 'most_total' },
  },
  {
    name: 'long forgotten',
    sentence: { filter: 'dormant', domain: null, window: '365d', sort: 'longest_quiet' },
  },
];

// ────────────────────────────────────────────────────────────────────
// Sentence evaluation — turns a Sentence into a Sender[] + count.
// ────────────────────────────────────────────────────────────────────

function evaluate(sentence: Sentence): { matched: Sender[]; total: number; visible: number } {
  let pool = SENDERS;
  if (sentence.domain) {
    const d = sentence.domain;
    pool = pool.filter((s) => s.domain.includes(d));
  }
  switch (sentence.filter) {
    case 'unsub_ready':
      pool = pool.filter((s) => s.unsubReady);
      break;
    case 'active':
      pool = pool.filter((s) => s.lastSeenDays <= 30);
      break;
    case 'quiet':
      pool = pool.filter((s) => s.lastSeenDays > 30 && s.lastSeenDays <= 180);
      break;
    case 'dormant':
      pool = pool.filter((s) => s.lastSeenDays > 180);
      break;
    case 'replied':
      pool = pool.filter((s) => s.replied > 0);
      break;
    case 'protected':
      pool = pool.filter((s) => s.protectedFlag);
      break;
    case 'everyone':
    default:
      break;
  }
  switch (sentence.window) {
    case '30d':
      pool = pool.filter((s) => s.lastSeenDays >= 30);
      break;
    case '90d':
      pool = pool.filter((s) => s.lastSeenDays >= 90);
      break;
    case '180d':
      pool = pool.filter((s) => s.lastSeenDays >= 180);
      break;
    case '365d':
      pool = pool.filter((s) => s.lastSeenDays >= 365);
      break;
    case 'all':
    default:
      break;
  }
  const sorted = [...pool].sort((a, b) => {
    switch (sentence.sort) {
      case 'most_total':
        return b.total - a.total;
      case 'fewest_total':
        return a.total - b.total;
      case 'recent':
        return a.lastSeenDays - b.lastSeenDays;
      case 'longest_quiet':
        return b.lastSeenDays - a.lastSeenDays;
      case 'name_az':
        return a.name.localeCompare(b.name);
      case 'name_za':
        return b.name.localeCompare(a.name);
      default:
        return 0;
    }
  });
  // Mock "mailbox-wide" count — project the filtered ratio onto the
  // whole mailbox total so the hero number feels real.
  const visible =
    sorted.length === SENDERS.length
      ? TOTAL_MAILBOX
      : Math.round((sorted.length / SENDERS.length) * TOTAL_MAILBOX);
  return { matched: sorted, total: TOTAL_MAILBOX, visible };
}

// ────────────────────────────────────────────────────────────────────
// Count-up animation — rolls the hero number when scope changes.
// ────────────────────────────────────────────────────────────────────

function useCountUp(target: number, durationMs = 480): number {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevRef.current === target) return;
    const from = prevRef.current;
    const to = target;
    const start = performance.now();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const tick = (t: number) => {
      const elapsed = t - start;
      const p = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevRef.current = to;
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return display;
}

// ────────────────────────────────────────────────────────────────────
// Token primitive — dotted-underline word that opens an inline popover.
// ────────────────────────────────────────────────────────────────────

type Option<V> = { value: V; label: string; note?: string };

function Token<V extends string>({
  value,
  label,
  options,
  onChange,
  group,
}: {
  value: V;
  label: string;
  options: Option<V>[];
  onChange: (next: V) => void;
  group?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
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

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block', whiteSpace: 'nowrap' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          fontFamily: 'inherit',
          fontSize: 'inherit',
          fontWeight: 'inherit',
          fontStyle: 'inherit',
          letterSpacing: 'inherit',
          color: 'inherit',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          borderBottom: open ? `1.5px solid ${C.accent}` : `1.5px dotted ${C.inkMuted}`,
          paddingBottom: 1,
          transition: 'border-color 200ms ease',
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.borderBottomColor = C.accent;
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.borderBottomColor = C.inkMuted;
        }}
      >
        {label}
      </button>
      {open && (
        <span
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 10px)',
            left: 0,
            zIndex: 80,
            minWidth: 240,
            background: C.card,
            border: `1px solid ${C.line}`,
            borderRadius: 9,
            boxShadow: '0 18px 50px rgba(14,20,19,0.20)',
            padding: 4,
            fontFamily: FONT_BODY,
            fontStyle: 'normal',
            fontSize: 13,
            color: C.ink,
            display: 'block',
            textAlign: 'left',
          }}
        >
          {group && (
            <span
              style={{
                display: 'block',
                padding: '6px 10px 2px',
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: C.inkMuted,
              }}
            >
              {group}
            </span>
          )}
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '8px 10px',
                  background: active ? 'rgba(14,20,19,0.05)' : 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  color: C.ink,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 12,
                    color: active ? C.accent : 'transparent',
                    fontWeight: 600,
                  }}
                >
                  ✓
                </span>
                <span style={{ flex: 1 }}>{opt.label}</span>
                {opt.note !== undefined && (
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      color: C.inkMuted,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {opt.note}
                  </span>
                )}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────
// Domain token — free-text input + suggestions.
// ────────────────────────────────────────────────────────────────────

function DomainToken({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = useCallback(() => {
    const trimmed = draft.trim().toLowerCase();
    onChange(trimmed.length === 0 ? null : trimmed);
    setOpen(false);
  }, [draft, onChange]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        commit();
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
  }, [open, commit, value]);

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const label = value ?? 'any domain';

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const set = new Set(SENDERS.map((s) => s.domain));
    const all = Array.from(set).sort();
    if (q.length === 0) return all.slice(0, 6);
    return all.filter((d) => d.includes(q)).slice(0, 6);
  }, [draft]);

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block', whiteSpace: 'nowrap' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          fontFamily: 'inherit',
          fontSize: 'inherit',
          fontStyle: 'inherit',
          color: 'inherit',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          borderBottom: open ? `1.5px solid ${C.accent}` : `1.5px dotted ${C.inkMuted}`,
          paddingBottom: 1,
          transition: 'border-color 200ms ease',
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.borderBottomColor = C.accent;
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.borderBottomColor = C.inkMuted;
        }}
      >
        {label}
      </button>
      {open && (
        <span
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 10px)',
            left: 0,
            zIndex: 80,
            minWidth: 260,
            background: C.card,
            border: `1px solid ${C.line}`,
            borderRadius: 9,
            boxShadow: '0 18px 50px rgba(14,20,19,0.20)',
            padding: 8,
            fontFamily: FONT_BODY,
            fontStyle: 'normal',
            fontSize: 13,
            color: C.ink,
            display: 'block',
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
            placeholder="any domain"
            style={{
              width: '100%',
              padding: '6px 8px',
              fontFamily: FONT_MONO,
              fontSize: 12,
              border: `1px solid ${C.line}`,
              borderRadius: 6,
              background: C.paper,
              color: C.ink,
              outline: 'none',
              marginBottom: 6,
            }}
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                setDraft('');
                onChange(null);
                setOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 8px',
                background: 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: FONT_BODY,
                fontSize: 12,
                color: C.amber,
                marginBottom: 2,
              }}
            >
              clear domain ←
            </button>
          )}
          {suggestions.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                onChange(d);
                setOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 8px',
                background: d === value ? 'rgba(14,20,19,0.05)' : 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: FONT_MONO,
                fontSize: 12,
                color: C.ink,
              }}
            >
              {d}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sparkbar — 30 segments of 1px-tall opacity, seeded per scope.
// ────────────────────────────────────────────────────────────────────

function Sparkbar({ scopeKey }: { scopeKey: string }) {
  const segs = useMemo(() => {
    const h = scopeKey.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
    const out: number[] = [];
    for (let i = 0; i < 30; i++) {
      const raw = Math.sin(((h + i) * 12.9898) % Math.PI);
      out.push(0.15 + Math.abs(raw) * 0.7);
    }
    return out;
  }, [scopeKey]);
  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        gap: 2,
        width: '100%',
        height: 3,
        marginTop: 18,
      }}
    >
      {segs.map((opacity, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            background: C.ink,
            opacity,
            transition: `opacity 260ms ease ${i * 8}ms`,
          }}
        />
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sentence component — the centered editorial moment.
// ────────────────────────────────────────────────────────────────────

function Statement({
  sentence,
  onChange,
}: {
  sentence: Sentence;
  onChange: (next: Sentence) => void;
}) {
  const { matched, total, visible } = useMemo(() => evaluate(sentence), [sentence]);
  const count = useCountUp(visible);
  const hidden = total - visible;
  const scopeKey = `${sentence.filter}|${sentence.domain}|${sentence.window}|${sentence.sort}`;

  return (
    <section
      aria-label="Sender scope"
      style={{
        padding: '8vh 0 6vh',
        textAlign: 'left',
        color: C.ink,
        fontFamily: FONT_EDITORIAL,
      }}
    >
      <div
        style={{
          fontFamily: FONT_BODY,
          fontSize: 14,
          fontWeight: 400,
          color: C.inkMuted,
          letterSpacing: '0.005em',
          marginBottom: 6,
        }}
      >
        I’m looking at
      </div>
      <div
        style={{
          fontFamily: FONT_EDITORIAL,
          fontSize: 'clamp(64px, 12vw, 132px)',
          fontWeight: 400,
          fontStyle: 'italic',
          lineHeight: 0.94,
          letterSpacing: '-0.04em',
          color: C.ink,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {count.toLocaleString()}
      </div>
      <div
        style={{
          marginTop: 18,
          fontFamily: FONT_EDITORIAL,
          fontSize: 'clamp(20px, 2.3vw, 26px)',
          fontWeight: 400,
          lineHeight: 1.45,
          letterSpacing: '-0.005em',
          color: C.ink,
          maxWidth: '64ch',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <Token<FilterKey>
          group="Filter"
          value={sentence.filter}
          label={FILTER_LABEL[sentence.filter]}
          options={[
            { value: 'everyone', label: 'everyone', note: TOTAL_MAILBOX.toLocaleString() },
            { value: 'unsub_ready', label: 'unsubscribe-ready', note: '38' },
            { value: 'active', label: 'active', note: '516' },
            { value: 'quiet', label: 'quiet', note: '740' },
            { value: 'dormant', label: 'dormant', note: '6,503' },
            { value: 'replied', label: "people I've replied to", note: '24' },
            { value: 'protected', label: 'protected', note: '8' },
          ]}
          onChange={(filter) => onChange({ ...sentence, filter })}
        />
        <span style={{ color: C.inkMuted, fontFamily: FONT_MONO, fontSize: 14 }}>·</span>
        <span style={{ color: C.inkSoft, fontStyle: 'italic' }}>from</span>
        <DomainToken
          value={sentence.domain}
          onChange={(domain) => onChange({ ...sentence, domain })}
        />
        <span style={{ color: C.inkMuted, fontFamily: FONT_MONO, fontSize: 14 }}>·</span>
        <Token<TimeWindowKey>
          group="Time window"
          value={sentence.window}
          label={WINDOW_LABEL[sentence.window]}
          options={[
            { value: 'all', label: 'any time' },
            { value: '30d', label: 'quiet for 30 days+' },
            { value: '90d', label: 'quiet for 90 days+' },
            { value: '180d', label: 'quiet for 6 months+' },
            { value: '365d', label: 'quiet for a year+' },
          ]}
          onChange={(window) => onChange({ ...sentence, window })}
        />
      </div>
      <div
        style={{
          marginTop: 8,
          fontFamily: FONT_EDITORIAL,
          fontSize: 'clamp(20px, 2.3vw, 26px)',
          fontWeight: 400,
          lineHeight: 1.45,
          color: C.ink,
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: C.inkSoft, fontStyle: 'italic' }}>sorted</span>
        <Token<SortKey>
          group="Order"
          value={sentence.sort}
          label={SORT_LABEL[sentence.sort]}
          options={[
            { value: 'most_total', label: 'biggest first' },
            { value: 'fewest_total', label: 'smallest first' },
            { value: 'recent', label: 'most recent first' },
            { value: 'longest_quiet', label: 'longest quiet first' },
            { value: 'name_az', label: 'A → Z' },
            { value: 'name_za', label: 'Z → A' },
          ]}
          onChange={(sort) => onChange({ ...sentence, sort })}
        />
        <span style={{ color: C.ink }}>.</span>
      </div>
      <Sparkbar scopeKey={scopeKey} />
      <div
        style={{
          marginTop: 14,
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: '0.04em',
          color: C.inkMuted,
          fontStyle: 'italic',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <span>{hidden.toLocaleString()} hidden · metadata only · no email bodies</span>
        <span aria-hidden style={{ flex: 1, height: 1, background: C.inkFaint }} />
        <span>{matched.length} loaded · scroll for more</span>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Saved-sentence tabs.
// ────────────────────────────────────────────────────────────────────

function SavedTabs({
  active,
  onPick,
  onSaveCurrent,
}: {
  active: string | null;
  onPick: (name: string) => void;
  onSaveCurrent: () => void;
}) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: '0.04em',
        color: C.inkMuted,
        display: 'flex',
        gap: 18,
        flexWrap: 'wrap',
        alignItems: 'center',
        padding: '14px 0 0',
      }}
    >
      {SAVED.map((s) => {
        const isActive = active === s.name;
        return (
          <button
            key={s.name}
            type="button"
            onClick={() => onPick(s.name)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: '0.04em',
              color: isActive ? C.ink : C.inkMuted,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span aria-hidden style={{ color: isActive ? C.amber : 'transparent', fontSize: 9 }}>
              ●
            </span>
            {s.name}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onSaveCurrent}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: '0.04em',
          color: C.inkSoft,
        }}
      >
        + save this view
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Card row — minimal repro of the existing SenderCard.
// ────────────────────────────────────────────────────────────────────

function SenderCard({ sender }: { sender: Sender }) {
  return (
    <article
      style={{
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: 10,
        padding: '16px 16px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minHeight: 180,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        {sender.protectedFlag && (
          <span
            title="Protected"
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: 999,
              background: C.emerald,
              marginRight: 4,
            }}
          />
        )}
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 14,
            fontWeight: 600,
            color: C.ink,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {sender.name}
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.inkMuted }}>
          {sender.domain}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            fontFamily: FONT_EDITORIAL,
            fontSize: 32,
            fontStyle: 'italic',
            fontWeight: 400,
            lineHeight: 0.95,
            color: C.ink,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.02em',
          }}
        >
          {sender.monthly}
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: C.inkMuted }}>
          in last 30d
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 0,
          paddingTop: 10,
          borderTop: `1px dashed ${C.line}`,
        }}
      >
        <Stat label="lifetime" value={sender.total.toLocaleString()} />
        <Stat
          label="last seen"
          value={sender.lastSeenDays === 0 ? 'today' : `${sender.lastSeenDays}d`}
        />
        <Stat label="you replied" value={sender.replied > 0 ? `${sender.replied}×` : '—'} />
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: '0.08em',
          color: C.inkMuted,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: FONT_BODY,
          fontSize: 14,
          fontWeight: 600,
          color: C.ink,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Page.
// ────────────────────────────────────────────────────────────────────

const DEFAULT_SENTENCE: Sentence = {
  filter: 'everyone',
  domain: null,
  window: 'all',
  sort: 'most_total',
};

export default function SendersLabV2() {
  const [sentence, setSentence] = useState<Sentence>(DEFAULT_SENTENCE);
  const [activeSaved, setActiveSaved] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const { matched } = useMemo(() => evaluate(sentence), [sentence]);

  const pickSaved = useCallback((name: string) => {
    const saved = SAVED.find((s) => s.name === name);
    if (!saved) return;
    setSentence(saved.sentence);
    setActiveSaved(name);
  }, []);

  const saveCurrent = useCallback(() => {
    setSavedToast('This is a prototype — saving would name + persist your sentence.');
    setTimeout(() => setSavedToast(null), 2400);
  }, []);

  const pageBg: CSSProperties = {
    background: C.paper,
    minHeight: '100vh',
    color: C.ink,
    fontFamily: FONT_BODY,
  };

  return (
    <main style={pageBg}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 32px 80px' }}>
        {/* Masthead */}
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: '0.12em',
            color: C.inkMuted,
            textTransform: 'uppercase',
            paddingBottom: 16,
            borderBottom: `1px solid ${C.line}`,
          }}
        >
          <span>declutrmail · senders · the reading room</span>
          <span>vol. XLVII — prototype</span>
        </header>

        <SavedTabs active={activeSaved} onPick={pickSaved} onSaveCurrent={saveCurrent} />

        <Statement
          sentence={sentence}
          onChange={(next) => {
            setSentence(next);
            setActiveSaved(null);
          }}
        />

        {savedToast && (
          <div
            role="status"
            style={{
              position: 'fixed',
              left: '50%',
              bottom: 28,
              transform: 'translateX(-50%)',
              padding: '10px 16px',
              background: C.ink,
              color: C.paper,
              borderRadius: 999,
              fontFamily: FONT_BODY,
              fontSize: 12,
              boxShadow: '0 12px 36px rgba(14,20,19,0.30)',
              zIndex: 90,
            }}
          >
            {savedToast}
          </div>
        )}

        {/* Card grid */}
        <section
          aria-label="Senders"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
            marginTop: 24,
          }}
        >
          {matched.map((s) => (
            <SenderCard key={s.id} sender={s} />
          ))}
          {matched.length === 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                padding: '40px 0',
                textAlign: 'center',
                color: C.inkMuted,
                fontStyle: 'italic',
                fontFamily: FONT_EDITORIAL,
                fontSize: 18,
              }}
            >
              No senders match. Loosen the scope above ↑
            </div>
          )}
        </section>

        {/* Kicker */}
        <footer
          style={{
            marginTop: 48,
            padding: '20px 0 0',
            borderTop: `1px solid ${C.line}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: '0.08em',
            color: C.inkMuted,
            textTransform: 'uppercase',
          }}
        >
          <span>fin. metadata only · no email bodies · no inference</span>
          <span>composed {new Date().toLocaleDateString()}</span>
        </footer>
      </div>
    </main>
  );
}
