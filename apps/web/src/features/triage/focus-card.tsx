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

const { color, font, motion, radius, shadow, space, text } = tokens;

/** The hero logo — the card is about one sender, so it leads at 72px. */
const LOGO = 72;

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
          padding: isNarrow
            ? `${space[8]}px ${space[5]}px ${space[6]}px`
            : `${space[10]}px ${space[8]}px`,
          background: color.card,
          borderRadius: radius.lg,
          border: `1px solid ${color.border}`,
          // pan-y: vertical drags stay with the browser; horizontal
          // swipes reach the pointer handlers (see `triage-row.tsx`).
          ...(isNarrow ? { touchAction: 'pan-y' as const } : null),
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            borderRadius: Math.round(LOGO * 0.28),
            boxShadow: shadow.card,
          }}
        >
          <Avatar
            name={row.senderName}
            domain={row.senderDomain}
            size={LOGO}
            hasMark={row.brandMark}
          />
        </span>
        <h2
          title={row.senderName}
          style={{
            margin: `${space[5]}px 0 0`,
            maxWidth: '100%',
            fontFamily: font.display,
            fontSize: 'clamp(26px, 3vw, 34px)',
            fontWeight: 400,
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
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
            marginTop: space[1],
            maxWidth: '100%',
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
          <span style={{ marginTop: space[3] }}>
            <ProtectedMark />
          </span>
        )}

        <span
          data-dm-focus-count
          style={{
            marginTop: space[8],
            fontFamily: font.display,
            fontSize: 'clamp(52px, 6vw, 70px)',
            fontWeight: 400,
            lineHeight: 1,
            letterSpacing: '-0.03em',
            color: color.fg,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {facts.count.toLocaleString('en-US')}
        </span>
        <span style={{ marginTop: space[2], fontSize: text.md, color: color.fgMuted }}>
          {facts.unit}
        </span>

        {facts.why !== null && (
          <p
            style={{
              margin: `${space[5]}px 0 0`,
              maxWidth: '36ch',
              fontSize: text.md,
              color: color.fgSoft,
              lineHeight: 1.5,
              textWrap: 'pretty',
            }}
          >
            {facts.why}
          </p>
        )}

        <button
          type="button"
          data-dm-button=""
          onClick={onToggleWhy}
          aria-expanded={whyOpen}
          aria-controls={`triage-focus-why-${row.id}`}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = color.fill;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
          style={{
            // Explicit resets, not `all: unset` — that also unsets the
            // global :focus-visible ring.
            marginTop: space[3],
            height: isNarrow ? 44 : 30,
            padding: `0 ${space[4]}px`,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'transparent',
            border: 'none',
            borderRadius: radius.pill,
            fontFamily: 'inherit',
            fontSize: text.sm,
            fontWeight: 600,
            color: color.fgSoft,
            cursor: 'pointer',
            transition: `background ${motion.fast} ${motion.ease}`,
          }}
        >
          {whyOpen ? 'Hide why' : 'Why?'}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{
              transform: whyOpen ? 'rotate(180deg)' : 'none',
              transition: `transform ${motion.fast} ${motion.ease}`,
            }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {whyOpen && (
          <div
            id={`triage-focus-why-${row.id}`}
            style={{
              width: '100%',
              marginTop: space[2],
              paddingTop: space[2],
              borderTop: `1px solid ${color.lineSoft}`,
            }}
          >
            <TriageRowExpanded row={row} />
          </div>
        )}

        {/* Mandatory while an action is pending — never behind the
            "Why?" disclosure (see `InlinePreviewBlock`). */}
        {inlinePreview != null && (
          <div style={{ width: '100%', marginTop: space[5] }}>
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

        <div style={{ width: '100%', marginTop: space[8] }}>
          <ActionToolbar
            row={row}
            onAction={onAction}
            keyboardEnabled={!actionsDisabled}
            disabled={actionsDisabled}
            layout={isNarrow ? 'bar' : 'row'}
            // One row on desktop: five 44px capsules with key hints wrap
            // 3 + 2 inside the card. Phones use the 44px two-column bar.
            size="md"
          />
        </div>
        {drag?.wouldResolve != null && <SwipeOverlay verb={drag.wouldResolve} />}
      </div>

      {/* SR announcement while the decision confirms server-side. */}
      {busy && (
        <span role="status" style={{ position: 'absolute', left: -9999 }}>
          Applying your decision for {row.senderName}
        </span>
      )}
    </section>
  );
}
