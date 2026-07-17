'use client';

/**
 * ReviewSession — guided per-sender decision ritual (modal card stack).
 *
 * NO LIVE MOUNT today: the Senders-screen opener was retired with the
 * editorial hero (spec v1.2 Decision 4) and its dead wiring removed in
 * the 2026-07-04 dead-code sweep. Kept as the chassis for the planned
 * dormant-sweep wizard (guided chunked review over a compose scope).
 *
 * Wiring rules for whoever resurrects it:
 *   - Destructive buckets must route through `requestAction` so the
 *     mandatory D226 preview gates every mutation — never fire verbs
 *     directly from session results.
 *   - A 'lock' (Protect) decision wires to `setPolicy({ isProtected:
 *     true })` — Protect is a standing-policy toggle, never a verb fire.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, Button, Eyebrow, Kbd, tokens, useFocusTrap } from '@declutrmail/shared';
import { type DecisionId, type ReviewKind, type Sender } from './data';

const { color, font } = tokens;

interface Option {
  id: DecisionId;
  label: string;
  tone: 'warn' | 'primary' | null;
}

interface KindConfig {
  eyebrow: string;
  tag: 'warn' | 'ok' | null;
  headline: string;
  sub: string;
  defaultAction: DecisionId;
  options: Option[];
  ctaTone: 'warn' | 'primary';
  historicToggle: string | null;
}

const KEEP: Option = { id: 'keep', label: 'Keep', tone: null };
const LATER: Option = { id: 'later', label: 'Later', tone: 'primary' };
const UNSUB: Option = { id: 'unsub', label: 'Unsubscribe', tone: 'warn' };

const KIND_CONFIG: Record<ReviewKind, KindConfig> = {
  promo: {
    eyebrow: 'Promotional sweep · plan-based Activity Undo',
    tag: 'warn',
    headline: 'Unsubscribe these marketers?',
    sub: "These senders rarely get opened. The default is Unsubscribe — downgrade any row to Later or Keep if you'd rather hang on to it.",
    defaultAction: 'unsub',
    options: [KEEP, LATER, UNSUB],
    ctaTone: 'warn',
    historicToggle: 'Also archive historic mail from unsubscribed senders',
  },
  quiet: {
    eyebrow: 'Newsletter pulse · plan-based Activity Undo',
    tag: null,
    headline: 'Decide what stays in the inbox.',
    sub: 'Low-volume senders you sometimes read. Keep the ones worth it, move the rest to Later, or unsubscribe entirely.',
    defaultAction: 'keep',
    options: [KEEP, LATER, UNSUB],
    ctaTone: 'primary',
    historicToggle: 'Also archive historic mail from unsubscribed senders',
  },
  protect: {
    eyebrow: 'Protected senders · permanent until removed',
    tag: 'ok',
    headline: 'Lock these in?',
    sub: "Once protected, no bulk action will touch these senders. Remove protection any time from the sender's detail page.",
    defaultAction: 'lock',
    options: [
      { id: 'lock', label: 'Lock', tone: 'primary' },
      { id: 'skip', label: 'Skip', tone: null },
    ],
    ctaTone: 'primary',
    historicToggle: null,
  },
};

const KIND_LABEL: Record<ReviewKind, string> = {
  promo: 'Promos worth dropping',
  quiet: 'Quiet keepers',
  protect: 'People to protect',
};

export interface ReviewResult {
  kind: ReviewKind;
  decisions: Record<string, DecisionId>;
  archiveHistoric: boolean;
}

/**
 * Full-bleed focused review overlay opened by a weekly-hero CTA. The
 * user lands on exactly the promised slice — per-row segmented
 * decisions, a bulk default, keyboard nav, ⌘⏎ to apply.
 */
export function ReviewSession({
  open,
  kind,
  senders,
  onApply,
  onCancel,
}: {
  open: boolean;
  kind: ReviewKind;
  senders: Sender[];
  onApply: (result: ReviewResult) => void;
  onCancel: () => void;
}) {
  const cfg = KIND_CONFIG[kind];

  const [decisions, setDecisions] = useState<Record<string, DecisionId>>({});
  const [bulkDefault, setBulkDefault] = useState(cfg.defaultAction);
  const [archiveHistoric, setArchiveHistoric] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);

  useEffect(() => {
    if (!open) return;
    const seeded: Record<string, DecisionId> = {};
    for (const s of senders) seeded[s.id] = cfg.defaultAction;
    setDecisions(seeded);
    setBulkDefault(cfg.defaultAction);
    setArchiveHistoric(false);
    setFocusIdx(0);
  }, [open, kind, senders, cfg.defaultAction]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of cfg.options) c[o.id] = 0;
    for (const v of Object.values(decisions)) c[v] = (c[v] ?? 0) + 1;
    return c;
  }, [decisions, cfg.options]);

  const changeCount = kind === 'protect' ? (counts.lock ?? 0) : senders.length - (counts.keep ?? 0);

  const apply = useCallback(() => {
    onApply({ kind, decisions, archiveHistoric });
  }, [onApply, kind, decisions, archiveHistoric]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        apply();
      } else if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((i) => Math.min(senders.length - 1, i + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, apply, onCancel, senders.length]);

  const trapRef = useFocusTrap<HTMLDivElement>(open);

  if (!open) return null;

  const setBulk = (next: DecisionId) => {
    setBulkDefault(next);
    const all: Record<string, DecisionId> = {};
    for (const s of senders) all[s.id] = next;
    setDecisions(all);
  };

  const ctaLabel =
    kind === 'protect'
      ? `Protect ${changeCount} ${changeCount === 1 ? 'sender' : 'senders'}`
      : `Apply ${changeCount} ${changeCount === 1 ? 'change' : 'changes'}`;

  return createPortal(
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dm-review-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: color.bg,
        zIndex: 90,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: font.sans,
        color: color.fg,
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          padding: '12px 28px',
          background: color.card,
          borderBottom: `1px solid ${color.line}`,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onCancel}
          style={{
            justifySelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            background: 'transparent',
            border: 'none',
            borderRadius: 6,
            color: color.fgSoft,
            fontFamily: font.mono,
            fontSize: 12.5,
            letterSpacing: '0.04em',
            cursor: 'pointer',
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to senders
        </button>
        <div
          style={{
            textAlign: 'center',
            fontFamily: font.mono,
            fontSize: 10.5,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: color.fgMuted,
          }}
        >
          Weekly review ·{' '}
          <strong style={{ color: color.fg, fontWeight: 700 }}>{KIND_LABEL[kind]}</strong>
        </div>
        <div
          style={{
            justifySelf: 'flex-end',
            fontFamily: font.mono,
            fontSize: 10.5,
            color: color.fgMuted,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <Kbd>Esc</Kbd> to close
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ maxWidth: 920, margin: '0 auto', width: '100%', padding: '32px 36px 24px' }}>
          <Eyebrow tone={cfg.tag === 'warn' ? 'amber' : cfg.tag === 'ok' ? 'primary' : 'default'}>
            {cfg.eyebrow}
          </Eyebrow>
          <h2
            id="dm-review-title"
            style={{
              margin: '12px 0 8px',
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: '-0.022em',
              lineHeight: 1.1,
            }}
          >
            {cfg.headline}
          </h2>
          <p
            style={{
              margin: '0 0 22px',
              color: color.fgSoft,
              fontSize: 14,
              lineHeight: 1.55,
              maxWidth: '62ch',
            }}
          >
            {cfg.sub}
          </p>

          {/* Bulk default */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              marginBottom: 14,
              background: color.paper,
              border: `1px solid ${color.line}`,
              borderRadius: 9,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 10.5,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: color.fgMuted,
              }}
            >
              Apply default to all
            </span>
            <Segmented options={cfg.options} value={bulkDefault} onChange={setBulk} />
            <span
              style={{
                marginLeft: 'auto',
                fontFamily: font.mono,
                fontSize: 10.5,
                color: color.fgMuted,
              }}
            >
              <strong style={{ color: color.fg, fontWeight: 700, fontSize: 12.5 }}>
                {senders.length}
              </strong>{' '}
              sender{senders.length === 1 ? '' : 's'}
            </span>
          </div>

          {/* Sender list */}
          <div
            style={{
              background: color.card,
              border: `1px solid ${color.line}`,
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            {senders.map((s, i) => (
              <ReviewRow
                key={s.id}
                s={s}
                options={cfg.options}
                value={decisions[s.id] ?? cfg.defaultAction}
                onChange={(next) => setDecisions((d) => ({ ...d, [s.id]: next }))}
                focused={focusIdx === i}
                onFocus={() => setFocusIdx(i)}
              />
            ))}
          </div>

          {cfg.historicToggle != null && (
            <button
              onClick={() => setArchiveHistoric((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '12px 14px',
                marginTop: 14,
                background: archiveHistoric ? color.primarySoft : color.paper,
                border: `1px dashed ${archiveHistoric ? color.primaryBorder : color.line}`,
                borderRadius: 9,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: font.sans,
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: `1.5px solid ${archiveHistoric ? color.primary : 'rgba(14,20,19,0.28)'}`,
                  background: archiveHistoric ? color.primary : color.card,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {archiveHistoric && (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              <span style={{ fontSize: 13, color: color.fgSoft }}>{cfg.historicToggle}</span>
            </button>
          )}
        </div>
      </div>

      {/* Commit bar */}
      <div
        style={{
          padding: '16px 28px',
          background: color.card,
          borderTop: `1px solid ${color.line}`,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <Tally counts={counts} options={cfg.options} />
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10.5,
            color: color.fgMuted,
            letterSpacing: '0.04em',
          }}
        >
          Archive, Later, and Delete use your plan&apos;s Activity Undo window · Activity logs every
          change
        </span>
        <Button tone="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          tone={cfg.ctaTone}
          disabled={changeCount === 0}
          onClick={apply}
          iconRight={
            <Kbd style={{ background: color.lineInverse, border: 'none', color: color.fgInverse }}>
              ⌘⏎
            </Kbd>
          }
        >
          {ctaLabel}
        </Button>
      </div>
    </div>,
    document.body,
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: DecisionId;
  onChange: (id: DecisionId) => void;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 6,
        padding: 2,
      }}
    >
      {options.map((opt) => {
        const on = opt.id === value;
        const onBg =
          opt.tone === 'warn' ? color.amber : opt.tone === 'primary' ? color.primary : color.fg;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            style={{
              padding: '4px 10px',
              background: on ? onBg : 'transparent',
              color: on ? color.fgInverse : color.fgSoft,
              border: 'none',
              borderRadius: 4,
              fontFamily: font.sans,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.12s, color 0.12s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ReviewRow({
  s,
  options,
  value,
  onChange,
  focused,
  onFocus,
}: {
  s: Sender;
  options: Option[];
  value: DecisionId;
  onChange: (id: DecisionId) => void;
  focused: boolean;
  onFocus: () => void;
}) {
  const why = [
    // `null` readRate = no timeseries yet — omit rather than claim 0%.
    s.readRate !== null ? `${Math.round(s.readRate * 100)}% read` : null,
    `${s.monthlyVolume ?? 0}/mo`,
    s.lastDays > 14 ? `last open ${Math.round(s.lastDays / 7)}w ago` : null,
  ]
    .filter((b): b is string => b != null)
    .join(' · ');

  return (
    <div
      onMouseEnter={onFocus}
      style={{
        display: 'grid',
        gridTemplateColumns: '32px 1fr 96px auto',
        gap: 14,
        alignItems: 'center',
        padding: '12px 18px',
        borderBottom: `1px solid ${color.lineSoft}`,
        background: focused ? 'rgba(14,20,19,0.025)' : 'transparent',
        transition: 'background 0.12s',
      }}
    >
      <Avatar name={s.name} domain={s.domain} size={28} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: 13.5,
            color: color.fg,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {s.name}
        </span>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10.5,
            color: color.fgMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {s.domain} · {why}
        </span>
      </div>
      <div
        style={{
          textAlign: 'right',
          fontFamily: font.mono,
          fontSize: 12.5,
          fontWeight: 600,
          color: color.fg,
        }}
      >
        {s.monthlyVolume ?? 0}
        <small
          style={{
            display: 'block',
            fontFamily: font.sans,
            fontSize: 10,
            color: color.fgMuted,
            fontWeight: 400,
          }}
        >
          per month
        </small>
      </div>
      <Segmented options={options} value={value} onChange={onChange} />
    </div>
  );
}

function Tally({ counts, options }: { counts: Record<string, number>; options: Option[] }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        gap: 12,
        fontFamily: font.mono,
        fontSize: 11,
        color: color.fgMuted,
        flexWrap: 'wrap',
      }}
    >
      {options.map((opt) => {
        const n = counts[opt.id] ?? 0;
        if (n === 0) return null;
        const swatch =
          opt.tone === 'warn'
            ? color.amber
            : opt.tone === 'primary'
              ? color.primary
              : color.fgMuted;
        return (
          <span key={opt.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: 9999, background: swatch }} />
            <strong style={{ color: color.fg, fontWeight: 700, fontSize: 12 }}>{n}</strong>
            <span>{opt.label.toLowerCase()}</span>
          </span>
        );
      })}
    </div>
  );
}
