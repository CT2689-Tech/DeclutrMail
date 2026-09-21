'use client';

import type { ReactNode } from 'react';
import { Avatar, tokens, useIsAtMost } from '@declutrmail/shared';

import { ActionToolbar } from './action-toolbar';
import { canArchive, canLater, type TriageDecisionRow } from './data';
import { InlinePreviewBlock, inlinePreviewGates, type InlinePreview } from './inline-preview';
import { SwipeOverlay } from './swipe-overlay';
import { ProtectedMark } from './triage-row';
import { TriageRowExpanded } from './triage-row-expanded';
import type { ActionVerb } from './types';
import { useSwipeVerb, type SwipeVerb } from './use-swipe-verb';
import { focusFacts } from './why-line';

const { color, font, motion, radius, text } = tokens;

/**
 * Focus mode — ONE sender, one decision (D29/D36).
 *
 * The card is the list row's information, re-cut for a glance: who, how
 * much (the one big number), why, and the five verbs with the engine's
 * suggestion as the only filled button. Everything else — the full
 * reasoning, its confidence band and age, the stats — sits behind
 * "Why?".
 *
 * It owns no decision logic. A verb routes through the SAME `onAction`
 * the list row uses, so D226's sheet/preview gates every mail-moving
 * verb, and the K/A/U/L/D listener is the one `ActionToolbar` already
 * binds — exactly one toolbar is mounted in focus mode, so exactly one
 * listener exists.
 */
export function TriageFocusCard({
  row,
  busy = false,
  whyOpen,
  onToggleWhy,
  onAction,
  inlinePreview,
  inlinePreviewAccountContext,
  unprotectSlot,
}: {
  row: TriageDecisionRow;
  /** True while this sender's decision is confirming server-side (D226 — no optimistic removal). */
  busy?: boolean;
  /**
   * The "Why?" disclosure. Controlled, and wired by the caller to the
   * store's `expandedRowId`: opening it is the user pointing at this
   * sender, which is what arms the D25 stale-read refresh — the same
   * contract as expanding a list row.
   */
  whyOpen: boolean;
  onToggleWhy: () => void;
  onAction: (verb: ActionVerb) => void;
  /** D34 remember-preference path — the mandatory preview, in the card. */
  inlinePreview?: InlinePreview | null;
  inlinePreviewAccountContext?: ReactNode;
  /** Forwarded to the inline preview's Protected notice (D245). */
  unprotectSlot?: ReactNode;
}) {
  const isNarrow = useIsAtMost('xs');
  const actionsDisabled = busy || inlinePreviewGates(inlinePreview).blocked;
  const facts = focusFacts(row);

  // D37 — the same gestures as the list row, same gates, same path.
  const { drag, handlers: swipeHandlers } = useSwipeVerb({
    enabled: isNarrow && !actionsDisabled,
    onVerb: (verb: SwipeVerb) => {
      if (verb === 'Archive' && !canArchive(row)) return;
      if (verb === 'Later' && !canLater(row)) return;
      onAction(verb);
    },
  });

  return (
    <section
      aria-label="Current decision"
      aria-busy={busy}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        opacity: busy ? 0.6 : 1,
        transition: `opacity ${motion.fast} ${motion.ease}`,
        fontFamily: font.sans,
      }}
    >
      <div
        {...(isNarrow ? swipeHandlers : {})}
        style={{
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          padding: isNarrow ? '28px 20px' : '40px 32px 32px',
          background: color.card,
          border: `1px solid ${color.line}`,
          borderRadius: radius.lg,
          // pan-y: vertical drags stay with the browser; horizontal
          // swipes reach the pointer handlers (see `triage-row.tsx`).
          ...(isNarrow ? { touchAction: 'pan-y' as const } : null),
        }}
      >
        <Avatar name={row.senderName} domain={row.senderDomain} size={56} hasMark={row.brandMark} />
        <h2
          title={row.senderName}
          style={{
            margin: '16px 0 0',
            maxWidth: '100%',
            fontSize: text['2xl'],
            fontWeight: 600,
            letterSpacing: '-0.014em',
            color: color.fg,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {row.senderName}
        </h2>
        <span
          title={row.senderEmail}
          style={{
            marginTop: 2,
            maxWidth: '100%',
            fontFamily: font.mono,
            fontSize: text.sm,
            color: color.fgMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {row.senderEmail}
        </span>
        {row.protectionReason !== null && (
          <span style={{ marginTop: 10 }}>
            <ProtectedMark />
          </span>
        )}

        <span
          data-dm-focus-count
          style={{
            marginTop: 24,
            fontFamily: font.display,
            fontSize: text['4xl'],
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            color: color.fg,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {facts.count.toLocaleString('en-US')}
        </span>
        <span style={{ marginTop: 6, fontSize: text.sm, color: color.fgMuted }}>{facts.unit}</span>

        {facts.why !== null && (
          <p
            style={{
              margin: '16px 0 0',
              fontSize: text.md,
              color: color.fgSoft,
              lineHeight: 1.5,
            }}
          >
            {facts.why}
          </p>
        )}

        <button
          type="button"
          onClick={onToggleWhy}
          aria-expanded={whyOpen}
          aria-controls={`triage-focus-why-${row.id}`}
          style={{
            // Explicit resets, not `all: unset` — that also unsets the
            // global :focus-visible ring.
            background: 'none',
            border: 'none',
            fontFamily: 'inherit',
            cursor: 'pointer',
            marginTop: 8,
            minHeight: isNarrow ? 44 : 28,
            padding: '0 8px',
            display: 'inline-flex',
            alignItems: 'center',
            fontSize: text.sm,
            fontWeight: 600,
            color: color.primary,
          }}
        >
          {whyOpen ? 'Hide why' : 'Why?'}
        </button>
        {whyOpen && (
          <div id={`triage-focus-why-${row.id}`} style={{ width: '100%' }}>
            <TriageRowExpanded row={row} />
          </div>
        )}

        {/* Mandatory while an action is pending — never behind the
            "Why?" disclosure (see `InlinePreviewBlock`). */}
        {inlinePreview != null && (
          <div style={{ width: '100%', marginTop: 16 }}>
            <InlinePreviewBlock
              row={row}
              preview={inlinePreview}
              busy={busy}
              shortcutLive
              accountContext={inlinePreviewAccountContext}
              unprotectSlot={unprotectSlot}
              onConfirm={() => onAction(inlinePreview.verb)}
            />
          </div>
        )}
        {drag?.wouldResolve != null && <SwipeOverlay verb={drag.wouldResolve} />}
      </div>

      <ActionToolbar
        row={row}
        onAction={onAction}
        keyboardEnabled={!actionsDisabled}
        disabled={actionsDisabled}
        layout={isNarrow ? 'bar' : 'row'}
      />

      {/* SR announcement while the decision confirms server-side. */}
      {busy && (
        <span role="status" style={{ position: 'absolute', left: -9999 }}>
          Applying your decision for {row.senderName}
        </span>
      )}
    </section>
  );
}
