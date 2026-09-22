'use client';

/**
 * The Senders list row — the ONE per-sender layout, on every width.
 *
 *   [logo]  Name ◆ (status)     1,204 emails   [Archive] (⋯)
 *           address
 *
 * The checkbox has no column of its own: it OVERLAYS the logo on row
 * hover / focus, whenever any row is selected, and always on touch
 * (see `sender-list.tsx`), so the list shares the title's left edge.
 *
 * The row keeps sender identity and received volume, with current inbox
 * scope and marked-read evidence when known. Deeper history and trends
 * remain in the detail pane.
 *
 * Clicking the row (not its checkbox or buttons) opens the sender. The
 * NAME is a real link to `/senders/[id]`, so keyboard and no-JS users get
 * the same destination; the host decides whether opening means the side
 * pane or the full page (`onOpen`).
 *
 * Phone (`compact`): the primary verb button does not fit beside the
 * number, so the row keeps only the `⋯` menu and gains swipe-right =
 * this row's primary verb. The swipe resolves through the SAME `onAction`
 * as the button, so a gesture can never bypass the D226 preview.
 *
 * Privacy (D7, D228): renders only allowlisted fields — name, address,
 * received count, unsubscribe lifecycle state.
 */

import { useCallback, useRef, useState, type MouseEvent } from 'react';
import type * as React from 'react';
import Link from 'next/link';
import { Avatar, Pill, tokens } from '@declutrmail/shared';
import { derivePrimaryVerbId, legacyVerbFromId, SenderActionRow } from './action-row';
import { isStandingProtected, senderAddressLine, type ActionRequest, type Sender } from './data';
import { RowCheckbox } from './row-checkbox';
import { formatReadRatePct } from './fact-language';
import styles from './sender-workspace.module.css';
import {
  isRowBusy,
  RowActivityPill,
  rowActivityLabel,
  useGroupActivitySummary,
  useRowActivity,
} from './row-activity';
import { unsubscribeStatusCopy } from './unsub-status';

const { color, motion, radius, text } = tokens;

/** Minimum travel (px) on the dominant axis before a row swipe resolves. */
export const ROW_SWIPE_THRESHOLD_PX = 56;
/** Dominant axis must beat the other by this ratio (rejects diagonals). */
export const ROW_SWIPE_DOMINANCE = 1.4;

/**
 * Pure resolver — pointer delta → did this resolve to a swipe-right?
 * Exported so tests pin the mapping without synthesising pointer streams.
 */
export function resolvesToSwipeRight(
  dx: number,
  dy: number,
  opts: { threshold?: number; dominance?: number } = {},
): boolean {
  const threshold = opts.threshold ?? ROW_SWIPE_THRESHOLD_PX;
  const dominance = opts.dominance ?? ROW_SWIPE_DOMINANCE;
  return dx >= threshold && dx >= Math.abs(dy) * dominance;
}

/** Touch-only swipe-right. `enabled=false` renders the handlers inert. */
function useSwipeRight(enabled: boolean, onSwipe: () => void) {
  const origin = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [armed, setArmed] = useState(false);

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
    setArmed(resolvesToSwipeRight(e.clientX - start.x, e.clientY - start.y));
  }, []);
  const settle = useCallback(
    (e: React.PointerEvent<HTMLElement>, fire: boolean) => {
      const start = origin.current;
      if (!start || e.pointerId !== start.pointerId) return;
      origin.current = null;
      setArmed(false);
      if (fire && resolvesToSwipeRight(e.clientX - start.x, e.clientY - start.y)) onSwipe();
    },
    [onSwipe],
  );
  const onPointerUp = useCallback<React.PointerEventHandler<HTMLElement>>(
    (e) => settle(e, true),
    [settle],
  );
  const onPointerCancel = useCallback<React.PointerEventHandler<HTMLElement>>(
    (e) => settle(e, false),
    [settle],
  );
  return { armed, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}

const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], [role="menu"]';

const SHIELD = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" />
  </svg>
);

/** Lifetime received stays distinct from the row's current inbox scope. */
function CountCell({
  value,
  unit,
  compact = false,
}: {
  value: number;
  unit: string;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: 1,
        minWidth: compact ? 48 : 64,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          display: 'flex',
          flexDirection: compact ? 'column' : 'row',
          alignItems: compact ? 'flex-end' : 'baseline',
          gap: compact ? 0 : 4,
        }}
      >
        <span
          style={{
            fontSize: text.md,
            fontWeight: 600,
            color: color.fg,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value.toLocaleString('en-US')}
        </span>
        <span style={{ fontSize: text.xs, color: color.fgMuted }}>{unit}</span>
      </span>
      <span style={{ fontSize: 11, color: color.fgMuted }}>received</span>
    </div>
  );
}

/** Row grid: logo (checkbox overlays it) · who · count · actions. */
const ROW_GRID = '44px minmax(0,1fr) auto auto';

export function SenderRow({
  s,
  selected,
  active = false,
  compact = false,
  onToggleSelect,
  onOpen,
  onAction,
}: {
  s: Sender;
  selected: boolean;
  /** This sender is the one open in the detail pane. */
  active?: boolean;
  /** Phone layout: `⋯` only, status pill by the name, swipe-right enabled. */
  compact?: boolean;
  onToggleSelect: (evt: MouseEvent) => void;
  /** Open this sender — the host picks the side pane or the full page. */
  onOpen: () => void;
  onAction: (req: ActionRequest) => void;
}) {
  const activity = useRowActivity(s.id);
  const busy = isRowBusy(activity);
  const addressLine = senderAddressLine(s);
  const unsub =
    s.policyType === 'unsubscribe'
      ? unsubscribeStatusCopy(s.unsubStatus, s.unsubscribeMethod)
      : null;

  const evidence = (s.inboxCount != null || s.readRate != null) && (
    <div className={styles.rowEvidence}>
      {s.inboxCount != null && <span>{s.inboxCount.toLocaleString('en-US')} in inbox</span>}
      {s.readRate != null && <span>{formatReadRatePct(s.readRate)}% marked read · 90d</span>}
    </div>
  );

  const swipe = useSwipeRight(compact, () => {
    // The same action the busy row's inert button refuses.
    if (busy) return;
    onAction({ verb: legacyVerbFromId(derivePrimaryVerbId(s)), senders: [s] });
  });

  return (
    <div
      role="listitem"
      data-testid={`sender-row-${s.id}`}
      data-sender-id={s.id}
      data-selected={selected || undefined}
      data-active={active || undefined}
      aria-busy={busy || undefined}
      className="dm-srow"
      onClick={(e) => {
        // Pointer convenience only — never steal a click meant for the
        // checkbox, a verb, the ⋯ menu or the name link.
        if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
        onOpen();
      }}
      {...swipe.handlers}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: ROW_GRID,
        alignItems: 'center',
        columnGap: compact ? 9 : 12,
        minHeight: 88,
        padding: '10px 12px',
        borderRadius: radius.sm,
        cursor: 'pointer',
        // Busy is a TINT, never a fade: opacity on the row would also fade
        // the status, the one thing the user needs to read.
        background: active ? color.primarySoft : busy ? color.fill : undefined,
        transition: `background ${motion.fast} ${motion.ease}`,
        // pan-y: vertical scroll stays with the browser; horizontal swipes
        // reach the pointer handlers.
        ...(compact ? { touchAction: 'pan-y' as const } : null),
      }}
    >
      <div style={{ position: 'relative', width: 44, height: 44 }}>
        <span className="dm-srow-avatar" style={{ display: 'flex' }}>
          <Avatar name={s.name} domain={s.domain} size={44} hasMark={s.brandMark} />
        </span>
        <div
          className="dm-srow-check"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <RowCheckbox
            checked={selected}
            onChange={(_, evt) => onToggleSelect(evt)}
            ariaLabel={`Select ${s.name}`}
            disabled={busy}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Link
            href={`/senders/${encodeURIComponent(s.id)}`}
            // `aria-label` overrides the contents, so the activity has to be
            // IN it or a screen reader never hears "Archiving…".
            aria-label={activity ? `${s.name}, ${rowActivityLabel(activity)}` : undefined}
            aria-current={active ? 'true' : undefined}
            title={s.email ? `${s.name} <${s.email}>` : s.name}
            onClick={(e) => {
              // Let the browser keep new-tab / new-window clicks.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              onOpen();
            }}
            style={{
              fontSize: text.md,
              fontWeight: 600,
              color: color.fg,
              textDecoration: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: compact ? 'normal' : 'nowrap',
              overflowWrap: compact ? 'anywhere' : undefined,
              minWidth: 0,
            }}
          >
            {s.name}
          </Link>
          {isStandingProtected(s) && (
            <span
              role="img"
              aria-label="Protected"
              title="Protected — left out of bulk and automatic actions"
              style={{ display: 'inline-flex', color: color.primary, flex: '0 0 auto' }}
            >
              {SHIELD}
            </span>
          )}
          {unsub && !compact && (
            <span title={unsub.title} style={{ display: 'inline-flex', flex: '0 0 auto' }}>
              <Pill>{unsub.label}</Pill>
            </span>
          )}
        </div>
        <span
          title={addressLine}
          style={{
            fontSize: text.sm,
            color: color.fgMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {addressLine}
        </span>
        {!compact && evidence}
      </div>

      <CountCell
        value={s.totalReceived}
        unit={s.totalReceived === 1 ? 'email' : 'emails'}
        compact={compact}
      />

      <SenderActionRow sender={s} onAction={onAction} compact={compact} />
      {compact && (unsub || activity || evidence) && (
        <div className={styles.compactRowContext}>
          {(unsub || activity) && (
            <div className={styles.compactRowStatus}>
              {unsub && (
                <span title={unsub.title}>
                  <Pill>{unsub.label}</Pill>
                </span>
              )}
              {activity && <RowActivityPill activity={activity} />}
            </div>
          )}
          {evidence}
        </div>
      )}

      {/* Live gesture feedback: while a touch drag would resolve to the
          swipe, name the verb so releasing is informed. */}
      {swipe.armed && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 20,
            borderRadius: radius.lg,
            background: color.card,
            opacity: 0.92,
            pointerEvents: 'none',
            zIndex: 2,
            fontSize: text.md,
            fontWeight: 600,
            color: color.fg,
          }}
        >
          → {legacyVerbFromId(derivePrimaryVerbId(s))}
        </div>
      )}
    </div>
  );
}

/**
 * Domain group header (D51 — eTLD+1 rollup). One collapsible row standing
 * in for ≥3 senders that share a registrable domain; expanded, its members
 * render as ordinary `SenderRow`s below it (the list owns that).
 *
 * Group-level ACTIONS are deliberately absent: every mutation keeps its
 * per-sender D226 preview.
 */
export function DomainGroupRow({
  domain,
  senderCount,
  totalReceived,
  memberIds,
  expanded,
  onToggleExpand,
}: {
  /** Registrable domain the members share (eTLD+1). */
  domain: string;
  senderCount: number;
  /** Sum of members' received totals (within retention, not all-time). */
  totalReceived: number;
  /** Member ids — the header reports their in-flight / finished actions. */
  memberIds: readonly string[];
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  // Collapsed, the member rows (and their status) are not on screen — so
  // the group has to say it, or acting inside a brand looks like nothing.
  const activity = useGroupActivitySummary(memberIds);
  return (
    <div role="listitem">
      <button
        type="button"
        data-testid={`domain-group-${domain}`}
        aria-expanded={expanded}
        aria-busy={activity?.busy || undefined}
        onClick={onToggleExpand}
        className="dm-srow"
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: '44px minmax(0,1fr) auto',
          alignItems: 'center',
          columnGap: 14,
          width: '100%',
          minHeight: 52,
          padding: '0 12px',
          border: 'none',
          borderRadius: radius.lg,
          background: 'transparent',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          transition: `background ${motion.fast} ${motion.ease}`,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            justifyContent: 'center',
            color: color.fgMuted,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: `transform ${motion.fast} ${motion.ease}`,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </span>
        {/* A quiet section header, not another row of content. */}
        <span
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            minWidth: 0,
            fontSize: text.sm,
            fontWeight: 600,
            color: color.fgMuted,
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {domain}
          </span>
          <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
            {senderCount} senders
            {activity && !expanded && (
              <>
                <span aria-hidden="true"> · </span>
                <span data-dm-group-activity style={{ color: color.fg }}>
                  {activity.label}
                </span>
              </>
            )}
          </span>
        </span>
        <CountCell value={totalReceived} unit="emails" />
      </button>
    </div>
  );
}
