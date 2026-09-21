'use client';

import { Avatar, Pill, tokens, useIsAtMost } from '@declutrmail/shared';
import type { PillTone } from '@declutrmail/shared';
import type { ReactNode } from 'react';

import { ActionToolbar } from './action-toolbar';
import { canArchive, canLater, type TriageDecisionRow } from './data';
import { InlinePreviewBlock, inlinePreviewGates, type InlinePreview } from './inline-preview';
import { SwipeOverlay } from './swipe-overlay';
import { verdictToVerb, type ActionVerb, type TriageVerdict } from './types';
import { TriageRowExpanded } from './triage-row-expanded';
import { useSwipeVerb, type SwipeVerb } from './use-swipe-verb';
import { whyLine } from './why-line';

const { color, font, motion, text } = tokens;

/** Pill tone per verdict — matches the toolbar's highlight semantics. */
const VERDICT_TONE: Record<TriageVerdict, PillTone> = {
  keep: 'primary',
  archive: 'dark',
  unsubscribe: 'amber',
  later: 'default',
};

/**
 * One row in the triage queue (D36 — collapse/expand pattern).
 *
 * Collapsed: avatar, name, domain, verdict pill, one-line why. Click
 * the row (or hit space/enter when focused) to expand. The confidence
 * band, the engine's reasoning and its age live in the expanded body.
 *
 * Expanded: the toolbar (K/A/U/L/D per amended D227) becomes visible,
 * the row body extends with the stats grid + reasoning + signals
 * (via `<TriageRowExpanded>`), and if a pending action is open in
 * inline-preview mode the pure preview strip mounts beneath
 * the toolbar.
 *
 * Per D198 / D36 only one row is expanded at a time — the
 * `expanded` flag is driven from the feature's Zustand store so the
 * queue and the action sheet can both read it.
 *
 * Mobile (D37, ≤xs): the header stacks and swipe gestures (→ Keep,
 * ← Archive, ↑ Later; see `use-swipe-verb.ts`) work on the row at
 * rest; the verb buttons mount on expand, as on desktop. Unsubscribe
 * stays button-only. Swipes route through the same onAction path, so
 * D226's preview still gates every destructive verb.
 */
export function TriageRow({
  row,
  expanded,
  busy = false,
  offerUnprotect = false,
  unprotectSlot,
  onToggleExpand,
  onAction,
  inlinePreview,
  inlinePreviewAccountContext,
}: {
  row: TriageDecisionRow;
  expanded: boolean;
  /**
   * True while this row's decision is confirming server-side (D226 —
   * no optimistic removal). The row dims, the toolbar disables, and
   * the K/A/U/L/D shortcuts release until the server confirms.
   */
  busy?: boolean;
  /**
   * Ignored. The hero row used to print the engine's reasoning at rest;
   * reasoning now lives behind an interaction everywhere. Still accepted
   * because the public inbox simulator passes it.
   */
  hero?: boolean;
  /**
   * Render a direct Unprotect control on a Protected row (D245).
   *
   * Off by default. The protection review turns it on because that
   * screen is ABOUT protection, so correcting a wrong one must not
   * require opening a mail verb's action sheet first. Everywhere else
   * the control lives inside the preview, next to the consequence it
   * belongs to.
   */
  offerUnprotect?: boolean;
  /**
   * The Unprotect control for a Protected row, constructed by the
   * caller (see `unprotect-button.tsx`) and rendered in the D245 row
   * strip below (`offerUnprotect`) or forwarded to the inline preview's
   * `ProtectedActionNotice`. This component never imports
   * `UnprotectButton` itself — that import drags in the sender-policy
   * mutation hook and the authenticated API client it calls.
   * Authenticated surfaces that pass `offerUnprotect` also construct
   * and pass this slot (see `triage-queue.tsx`); the public simulator
   * intentionally leaves it `undefined`, removing this row's auth/query
   * edge from the public route-specific chunk.
   */
  unprotectSlot?: ReactNode;
  onToggleExpand: () => void;
  onAction: (verb: ActionVerb) => void;
  /**
   * If present, the inline preview strip renders inside the
   * expanded row body — the D34 remember-preference path where the
   * sheet is suppressed but D226's preview is still mandatory.
   */
  inlinePreview?: InlinePreview | null;
  /** Authenticated queues inject the active Gmail account note; public demos omit it. */
  inlinePreviewAccountContext?: ReactNode;
}) {
  const actionsDisabled = busy || inlinePreviewGates(inlinePreview).blocked;

  // W1 (2026-07-02 audit) — below the xs ceiling the single-row grid's
  // auto columns consumed the full viewport and the identity cell
  // (`minmax(0, 1fr)`) collapsed to zero width: avatar + chip rendered,
  // sender name/domain vanished. At ≤480px the header stacks instead —
  // identity keeps the full track on row 1 and the pill moves to row 2.
  // The second auto column (a standalone `Recommended` hint) is gone
  // entirely now, so both widths show the same badge and the same
  // information — the narrow layout is a reflow, not a downgrade.
  const isNarrow = useIsAtMost('xs');

  // D37 — swipe gestures on the mobile card. A swipe resolves to the
  // SAME onAction path the buttons use (destructive verbs still open
  // the D226 sheet/preview — a swipe never mutates directly), gated by
  // the row's capability rules. Touch pointers only.
  const { drag, handlers: swipeHandlers } = useSwipeVerb({
    enabled: isNarrow && !actionsDisabled,
    onVerb: (verb: SwipeVerb) => {
      if (verb === 'Archive' && !canArchive(row)) return;
      if (verb === 'Later' && !canLater(row)) return;
      onAction(verb);
    },
  });

  return (
    <div
      aria-busy={busy}
      {...(isNarrow ? swipeHandlers : {})}
      style={{
        position: 'relative',
        borderBottom: `1px solid ${color.line}`,
        transition: `opacity ${motion.fast} ${motion.ease}`,
        opacity: busy ? 0.6 : 1,
        // pan-y: vertical drags stay with the browser (list scrolling
        // survives); horizontal swipes reach the pointer handlers. An
        // up-swipe resolves only when the page doesn't consume it as a
        // scroll — the Later button always remains (gestures augment,
        // never replace).
        ...(isNarrow ? { touchAction: 'pan-y' as const } : null),
      }}
    >
      {/* Collapsed header — always rendered. */}
      <div
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={`triage-row-body-${row.id}`}
        aria-label={`${row.senderName} — ${expanded ? 'collapse' : 'expand'} triage detail`}
        style={{
          display: 'grid',
          gridTemplateColumns: isNarrow
            ? '32px minmax(0, 1fr) 18px'
            : '32px minmax(0, 1fr) auto 18px',
          gap: 12,
          alignItems: 'center',
          padding: '14px 4px',
          minHeight: 44,
          cursor: 'pointer',
        }}
      >
        <Avatar name={row.senderName} domain={row.senderDomain} size={32} hasMark={row.brandMark} />

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span
              title={row.senderName}
              style={{
                fontWeight: 600,
                fontSize: text.md,
                color: color.fg,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {row.senderName}
            </span>
            {row.protectionReason !== null && <ProtectedMark />}
          </div>
          <span
            title={row.senderDomain}
            style={{
              fontFamily: font.mono,
              fontSize: text.xs,
              color: color.fgMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.senderDomain}
          </span>
          {/* The why-line wraps below identity on narrow widths; it
              stays on one line on desktop because the grid template
              keeps the identity cell minmax(0, 1fr). */}
          <span
            title={whyLine(row)}
            style={{
              fontSize: text.sm,
              color: color.fgSoft,
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {whyLine(row)}
          </span>
        </div>

        {/* Verdict pill — the engine's current recommendation. Its
            confidence band lives in the expanded body. On the stacked
            narrow layout it moves to its own row under the identity
            block (W1). */}
        <Pill
          tone={VERDICT_TONE[row.verdict]}
          style={isNarrow ? { gridColumn: 2, gridRow: 2, justifySelf: 'start' } : {}}
        >
          {verdictToVerb(row.verdict)}
        </Pill>

        {/* Chevron — rotates to indicate expand state. Pinned to the
            first row's trailing column on the stacked layout. */}
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: color.fgMuted,
            fontSize: text.md,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: `transform ${motion.fast} ${motion.ease}`,
            ...(isNarrow ? { gridColumn: 3, gridRow: 1 } : null),
          }}
        >
          ›
        </span>
      </div>

      {/* The D245 safety state, changeable in place. Deliberately its
          OWN strip rather than a sixth button in the verb toolbar: the
          verbs decide what happens to this sender's email, Unprotect
          decides whether cleanup may reach them at all, and putting the
          two in one row is what made an earlier draft bundle them. Only
          the protection review asks for it — daily Triage keeps the
          notice inside the preview, where the user is already acting. */}
      {offerUnprotect && row.protectionReason !== null && (
        <ProtectionStrip unprotectSlot={unprotectSlot} />
      )}

      {/* Expanded body — toolbar + reasoning + stats. The toolbar (and
          with it the K/A/U/L/D key listener) mounts ONLY here: one
          listener per mounted toolbar is what let a single 'K' press
          dispatch Keep for every row on narrow widths (2026-07-16). */}
      {expanded && (
        <div
          id={`triage-row-body-${row.id}`}
          style={{ display: 'flex', flexDirection: 'column', padding: '0 4px 12px 48px' }}
        >
          <ActionToolbar
            row={row}
            onAction={onAction}
            keyboardEnabled={!actionsDisabled}
            disabled={actionsDisabled}
            layout={isNarrow ? 'bar' : 'row'}
          />
          <TriageRowExpanded row={row} />
        </div>
      )}

      {/* Mandatory while an action is pending — rendered on
          `inlinePreview` alone, never on `expanded` (see
          `InlinePreviewBlock`). */}
      {inlinePreview != null && (
        <div style={{ padding: '0 4px 16px' }}>
          <InlinePreviewBlock
            row={row}
            preview={inlinePreview}
            busy={busy}
            shortcutLive={expanded}
            accountContext={inlinePreviewAccountContext}
            // The D245 review's row strip already renders `unprotectSlot`
            // above; without this, a protected row with D34's
            // remember-preference set stacks two identical Unprotect
            // buttons and two overlapping sentences on the same row.
            unprotectSlot={offerUnprotect ? undefined : unprotectSlot}
            onConfirm={() => onAction(inlinePreview.verb)}
          />
        </div>
      )}
      {drag?.wouldResolve != null && <SwipeOverlay verb={drag.wouldResolve} />}
      {/* SR announcement while the decision confirms server-side. */}
      {busy && (
        <span role="status" style={{ position: 'absolute', left: -9999 }}>
          Applying your decision for {row.senderName}
        </span>
      )}
    </div>
  );
}

/** The one visible safety state (D245), as a quiet mark beside the name. */
export function ProtectedMark() {
  return (
    <span
      title="Protected — automatic and bulk actions stay off unless you choose otherwise"
      style={{
        padding: '1px 8px',
        borderRadius: 9999,
        fontSize: text.xs,
        fontWeight: 600,
        background: color.primarySoft,
        color: color.primary,
        flexShrink: 0,
      }}
    >
      Protected
    </span>
  );
}

/**
 * NOT the reason — the why-line already carries that, and repeating it
 * made every row say "you starred a message" twice. What is missing
 * there is the CONSEQUENCE, which is the whole reason the Unprotect
 * control exists.
 */
export function ProtectionStrip({ unprotectSlot }: { unprotectSlot: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        padding: '0 4px 12px',
        textAlign: 'left',
      }}
    >
      <span style={{ fontSize: text.sm, color: color.fgSoft, lineHeight: 1.45 }}>
        Bulk and automatic cleanup skip this sender.
      </span>
      {unprotectSlot}
    </div>
  );
}
