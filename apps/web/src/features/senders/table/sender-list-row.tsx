'use client';

import { useCallback, useRef, useState, type MouseEvent } from 'react';
import type * as React from 'react';
import { Avatar, tokens, useIsAtMost } from '@declutrmail/shared';
// Direct module path, not the barrel: `optimizePackageImports` rewrites the
// barrel import to an uninitialised binding for this hook specifically
// (same class as MISTAKES.md 2026-08-27, "A shipped `undefined` no test
// could see" — PR #651). A sibling import in the same statement does NOT
// protect against it, so import every barrel-covered value that breaks this
// way from its real path instead of adding more siblings.
import { useLongPress } from '@declutrmail/shared/hooks/use-long-press';
import { derivePrimaryVerbId, legacyVerbFromId, SenderActionRow } from '../action-row';
import { isStandingProtected, type ActionRequest, type Sender } from '../data';
import { RowCheckbox } from './row-checkbox';
import { SenderRowDetailLive } from './sender-row-detail';

const { color, font } = tokens;

/** Minimum travel (px) on the dominant axis before a row swipe resolves. */
export const ROW_SWIPE_THRESHOLD_PX = 56;
/** Dominant axis must beat the other by this ratio (rejects diagonals). */
export const ROW_SWIPE_DOMINANCE = 1.4;

export type RowSwipeDirection = 'left' | 'right';

/**
 * Pure resolver — pointer delta → swipe direction, or `null` when the
 * gesture is under threshold, diagonal, or vertical. Exported so tests
 * pin the mapping without synthesising real pointer streams. Mirrors
 * `triage/use-swipe-verb.ts`'s resolver shape; kept local (not shared)
 * because the two features resolve to different things — a fixed
 * Keep/Archive/Later map there, a per-row derived primary verb here.
 */
export function resolveRowSwipeDirection(
  dx: number,
  dy: number,
  opts: { threshold?: number; dominance?: number } = {},
): RowSwipeDirection | null {
  const threshold = opts.threshold ?? ROW_SWIPE_THRESHOLD_PX;
  const dominance = opts.dominance ?? ROW_SWIPE_DOMINANCE;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= threshold && ax >= ay * dominance) {
    return dx > 0 ? 'right' : 'left';
  }
  return null;
}

interface RowSwipeDragState {
  dx: number;
  /** The direction the drag WOULD resolve to if released now (hint layer). */
  wouldResolve: RowSwipeDirection | null;
}

/**
 * D54 (ADR-0018) — attachable pointer handlers + live drag state for the
 * mobile row's swipe-right (primary CTA) / swipe-left (expand) gesture.
 * `enabled=false` (desktop breakpoints, select mode) renders the
 * handlers inert. Only primary-button touch pointers track.
 */
function useRowSwipe({
  enabled,
  onSwipeRight,
  onSwipeLeft,
}: {
  enabled: boolean;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
}): {
  drag: RowSwipeDragState | null;
  handlers: {
    onPointerDown: React.PointerEventHandler<HTMLElement>;
    onPointerMove: React.PointerEventHandler<HTMLElement>;
    onPointerUp: React.PointerEventHandler<HTMLElement>;
    onPointerCancel: React.PointerEventHandler<HTMLElement>;
  };
} {
  const origin = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [drag, setDrag] = useState<RowSwipeDragState | null>(null);

  const onPointerDown = useCallback<React.PointerEventHandler<HTMLElement>>(
    (e) => {
      if (!enabled || e.pointerType !== 'touch') return;
      origin.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    },
    [enabled],
  );

  const onPointerMove = useCallback<React.PointerEventHandler<HTMLElement>>((e) => {
    const start = origin.current;
    if (!start || e.pointerId !== start.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    setDrag({ dx, wouldResolve: resolveRowSwipeDirection(dx, dy) });
  }, []);

  const settle = useCallback(
    (e: React.PointerEvent<HTMLElement>, fire: boolean) => {
      const start = origin.current;
      if (!start || e.pointerId !== start.pointerId) return;
      origin.current = null;
      setDrag(null);
      if (!fire) return;
      const direction = resolveRowSwipeDirection(e.clientX - start.x, e.clientY - start.y);
      if (direction === 'right') onSwipeRight();
      else if (direction === 'left') onSwipeLeft();
    },
    [onSwipeRight, onSwipeLeft],
  );

  const onPointerUp = useCallback<React.PointerEventHandler<HTMLElement>>(
    (e) => settle(e, true),
    [settle],
  );
  const onPointerCancel = useCallback<React.PointerEventHandler<HTMLElement>>(
    (e) => settle(e, false),
    [settle],
  );

  return { drag, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}

/**
 * Render a `Sender.volumeTrend` bucket as a short evidence-line token.
 * Returns `null` when the bucket should be omitted from the line (no
 * history, or `steady` — which would only add noise to the row).
 *
 * Bucketed labels (per Codex review on the senders-tightening v2
 * brief) — never a raw percentage. False precision on small baselines
 * is the failure mode we're avoiding.
 */
function trendToken(s: Sender): string | null {
  if (!s.volumeTrend || s.volumeTrend === 'steady') return null;
  if (s.volumeTrend === 'up') return '↑ Up';
  if (s.volumeTrend === 'down') return '↓ Down';
  if (s.volumeTrend === 'dormant') return '○ Dormant';
  return '• New';
}

/**
 * Build the row evidence line.
 *
 * Tightening pass — see senders-tightening v2 brief. Replaces the
 * old `whyLine` + 2-cell numeric grid (volume + read%) with a single
 * bounded-token line. Token order is deterministic; tokens are
 * single-word / single-glyph compact (no long prose). The row clamps
 * to one line and ellipsis-truncates from the recency token first.
 *
 * Token order (highest decision weight first, last to truncate):
 *   1. `<N>/mo`             — cadence (always present unless 0)
 *   2. `<trend>`            — Up / Down / Dormant / New (omitted on steady)
 *   3. `<read-state>`       — "Almost never marked read" etc. when
 *                              the signal is decision-grade, otherwise
 *                              omitted to keep the line short
 *   4. `Last seen <recency>`— recency token (first to truncate on
 *                              narrow widths)
 *
 * Vocabulary: "marked read" never "opened" — Gmail exposes no open
 * events (Codex review). The `volumeTrend` chip is the canonical
 * place for trend, never an inferred percentage in this string.
 */
function buildEvidenceTokens(s: Sender): string[] {
  const tokens: string[] = [];

  const monthly = s.monthlyVolume ?? 0;
  if (monthly > 0) {
    tokens.push(`${monthly}/mo`);
  }

  const trend = trendToken(s);
  if (trend) tokens.push(trend);

  // Read-state phrase — only emit when it's strong enough to drive a
  // decision. A `null` readRate means "no timeseries yet" — that is
  // never evidence, so the line stays silent rather than claiming
  // "never read" from missing data.
  // Both phrases name the 30-day window. Unqualified, "Almost never
  // marked read" was a lifetime-sounding claim built from 30 days —
  // etherscan (0 read of 9 in 30d, 96.5% read lifetime) hit this exact
  // branch. See FINDINGS F008.
  if (s.readRate !== null) {
    const read = Math.round(s.readRate * 100);
    if (read <= 5 && monthly >= 8) {
      tokens.push('Rarely marked read in the last 90d');
    } else if (read >= 70) {
      tokens.push(`${read}% marked read in the last 90d`);
    }
  }

  // Recency token — last because narrow widths drop it first.
  if (s.lastDays === 0) {
    tokens.push('Last seen today');
  } else if (s.lastDays === 1) {
    tokens.push('Last seen yesterday');
  } else if (s.lastDays < 7) {
    tokens.push(`Last seen ${s.lastDays}d ago`);
  } else if (s.lastDays < 60) {
    tokens.push(`Last seen ${Math.round(s.lastDays / 7)}w ago`);
  } else {
    tokens.push(`Last seen ${Math.round(s.lastDays / 30)}mo ago`);
  }

  return tokens;
}

/**
 * One sender row in a category bloc. Click anywhere to expand the detail.
 *
 * D54 (ADR-0018) phone dialect (`useIsAtMost('xs')`, ≤480px): the
 * checkbox column hides until `selectMode`; the row instead gains two
 * touch-only gestures that resolve through the SAME `onAction` path the
 * primary button already uses, so a gesture can never bypass the D226
 * preview on a destructive verb —
 *   - swipe-right → fire this row's derived primary verb (Keep applies
 *     immediately per D40; Archive/Later/Unsubscribe/Delete open the
 *     mandatory preview exactly as tapping the button would)
 *   - swipe-left  → tap-expand (same as tapping the row)
 *   - long-press  → enter multi-select mode and select this row
 */
export function SenderListRow({
  s,
  selected,
  onToggleSelect,
  expanded,
  onToggleExpand,
  onAction,
  selectMode = false,
  onLongPress,
}: {
  s: Sender;
  selected: boolean;
  onToggleSelect: (evt: MouseEvent) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onAction: (req: ActionRequest) => void;
  /** D54 — true once a long-press has entered multi-select on this list. */
  selectMode?: boolean;
  /** D54 — long-press callback; omitted on surfaces with no multi-select mode. */
  onLongPress?: () => void;
}) {
  // Below `sm` the evidence line drops so the row keeps the name +
  // actions reachable without horizontal clipping. The evidence-line
  // tokens are deterministically ordered so when the visible string
  // truncates on a narrow desktop it loses the lowest-weight token
  // first (recency) and keeps the highest-weight ones (cadence,
  // trend, read-state phrase).
  const isMobile = useIsAtMost('sm');
  // D54 phone dialect — a narrower ceiling than the `sm` tightening
  // above. Gestures and the hide-until-select-mode checkbox apply only
  // at true phone width; a tablet between `xs` and `sm` keeps the
  // desktop-shaped row (ADR-0018 "tablet uses desktop layout w/ touch
  // targets bumped").
  const isPhone = useIsAtMost('xs');
  const evidenceTokens = buildEvidenceTokens(s);
  const evidenceLine = evidenceTokens.join(' · ');

  const gesturesEnabled = isPhone && !selectMode;
  const longPress = useLongPress({
    enabled: gesturesEnabled && onLongPress != null,
    onLongPress: () => onLongPress?.(),
  });
  const swipe = useRowSwipe({
    enabled: gesturesEnabled,
    onSwipeRight: () => {
      const primaryVerbId = derivePrimaryVerbId(s);
      onAction({ verb: legacyVerbFromId(primaryVerbId), senders: [s] });
    },
    onSwipeLeft: onToggleExpand,
  });

  const showCheckbox = !isPhone || selectMode;

  return (
    <>
      <div
        onClick={(e) => {
          if (selectMode) {
            onToggleSelect(e);
            return;
          }
          onToggleExpand();
        }}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${s.name} — ${expanded ? 'collapse' : 'expand'} detail`}
        onPointerDown={(e) => {
          longPress.onPointerDown(e);
          swipe.handlers.onPointerDown(e);
        }}
        onPointerMove={(e) => {
          longPress.onPointerMove(e);
          swipe.handlers.onPointerMove(e);
        }}
        onPointerUp={(e) => {
          longPress.onPointerUp(e);
          swipe.handlers.onPointerUp(e);
        }}
        onPointerCancel={(e) => {
          longPress.onPointerCancel(e);
          swipe.handlers.onPointerCancel(e);
        }}
        style={{
          position: 'relative',
          display: 'grid',
          // Tightening pass — dropped the 2-cell numeric stat block
          // (volume + read%) in favour of a single bounded evidence
          // line. The grid is now one cell narrower per row, freeing
          // ~272px for the action cluster + chevron without changing
          // overall row height. See senders-tightening v2 brief.
          // D54 phone dialect drops two children entirely (the primary
          // action row moves into the expanded panel; the checkbox
          // hides until `selectMode`), so the column count itself
          // differs from the desktop/tablet row — not just the widths.
          // Each branch's column count must match its real child count
          // exactly, or the trailing chevron drifts into a column meant
          // for a hidden sibling instead of sitting at the row's edge.
          gridTemplateColumns: isPhone
            ? selectMode
              ? '20px 36px minmax(0,1fr) 22px' // checkbox · avatar · name · chevron
              : '36px minmax(0,1fr) 22px' // avatar · name · chevron
            : isMobile
              ? '20px 32px minmax(0,1fr) auto 22px' // + evidence hidden, action row shown
              : '20px 32px minmax(0,1.7fr) minmax(0,1.5fr) 156px 22px',
          gap: isMobile ? 10 : 14,
          alignItems: 'center',
          padding: '12px 16px',
          background: expanded ? 'rgba(14,20,19,0.028)' : 'transparent',
          cursor: 'pointer',
          borderBottom: `1px solid ${color.lineSoft}`,
          boxShadow: expanded ? `inset 3px 0 0 ${color.primary}` : undefined,
          transition: 'background 0.12s',
          // pan-y: vertical scrolling stays with the browser; horizontal
          // swipes reach the pointer handlers above (matches the D37
          // triage card's gesture contract).
          ...(gesturesEnabled ? { touchAction: 'pan-y' as const } : null),
        }}
        onMouseEnter={(e) => {
          if (!expanded) e.currentTarget.style.background = 'rgba(14,20,19,0.015)';
        }}
        onMouseLeave={(e) => {
          if (!expanded) e.currentTarget.style.background = 'transparent';
        }}
      >
        {showCheckbox && (
          <div onClick={(e) => e.stopPropagation()}>
            <RowCheckbox
              checked={selected}
              onChange={(_, evt) => onToggleSelect(evt)}
              ariaLabel={`Select ${s.name}`}
            />
          </div>
        )}

        <Avatar name={s.name} domain={s.domain} size={isPhone ? 36 : 28} hasMark={s.brandMark} />

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: 13.5,
                letterSpacing: '-0.005em',
                color: color.fg,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {s.name}
            </span>
            {isStandingProtected(s) && (
              <span
                title="Protected — automatic and bulk actions stay off unless you choose otherwise"
                style={{
                  padding: '1px 7px',
                  borderRadius: 4,
                  fontFamily: font.mono,
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  background: color.primarySoft,
                  color: color.primary,
                  border: `1px solid ${color.primaryBorder}`,
                  flexShrink: 0,
                }}
              >
                Protected
              </span>
            )}
          </div>
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
            {s.domain}
          </span>
        </div>

        {!isMobile && (
          <span
            title={evidenceLine}
            style={{
              fontSize: 12.5,
              color: color.fgSoft,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {evidenceLine}
          </span>
        )}

        {!isPhone && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}
          >
            <SenderActionRow sender={s} onAction={onAction} />
          </div>
        )}

        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            color: color.fgMuted,
            fontFamily: font.mono,
            fontSize: 14,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        >
          ›
        </span>

        {/* D54 — live gesture feedback: while a touch drag would resolve
            to a swipe, name it over the row so releasing is informed.
            Mirrors the D37 triage card's hint layer. */}
        {swipe.drag?.wouldResolve != null && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: swipe.drag.wouldResolve === 'right' ? 'flex-start' : 'flex-end',
              paddingLeft: 20,
              paddingRight: 20,
              background: 'rgba(255,255,255,0.85)',
              backdropFilter: 'blur(1px)',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: color.fg,
              }}
            >
              {swipe.drag.wouldResolve === 'right'
                ? `→ ${legacyVerbFromId(derivePrimaryVerbId(s))}`
                : '← Expand'}
            </span>
          </div>
        )}
      </div>

      {expanded && <SenderRowDetailLive s={s} onAction={onAction} />}
    </>
  );
}
