'use client';

import { Avatar, Button, Pill, tokens, useIsAtMost } from '@declutrmail/shared';
import type { PillTone } from '@declutrmail/shared';
import type { ReactNode } from 'react';

import { ActionPreviewPresentation, type PreviewCount } from './action-preview-presentation';
import { ActionToolbar } from './action-toolbar';
import { canArchive, canLater, type TriageDecisionRow } from './data';
import { VERB_SHORTCUT, verdictToVerb, type ActionVerb, type TriageVerdict } from './types';
import { TriageRowExpanded } from './triage-row-expanded';
import { useSwipeVerb, type SwipeVerb } from './use-swipe-verb';

const { color, font } = tokens;

/** Pill tone per verdict — matches the toolbar's highlight semantics. */
const VERDICT_TONE: Record<TriageVerdict, PillTone> = {
  keep: 'primary',
  archive: 'dark',
  unsubscribe: 'amber',
  later: 'default',
};

/**
 * Tight one-line "why" for the collapsed row (D36 — critical info
 * default). Uses `last90dMessages` instead of the derived
 * `monthlyVolume = round(last90 / 3)` so a sender that mailed twice in
 * the last 90d reads as "2 in last 90d", not "0/mo" — the lie pattern
 * founder caught 2026-06-06 (same class as Sender Detail Bug 3).
 *
 * Quiet senders (no mail in 90d but real lifetime presence) get an
 * explicit "Quiet 90d" copy instead of a fabricated "0/mo".
 */
function whyLine(row: TriageDecisionRow): string {
  const pct = Math.round(row.readRate * 100);
  if (row.protectionReason === 'user-marked') return 'Protected — always kept';
  if (row.protectionReason === 'replied') return 'Protected · you replied at least 3 times';
  if (row.protectionReason === 'starred') return 'Protected · you starred a message';
  if (row.protectionReason === 'gmail-important') return 'Protected · Gmail importance';
  if (row.last90dMessages === 0) {
    // Quiet within the rolling window — say so plainly. Lifetime total
    // carries the "they DID mail you" context without faking cadence.
    return `Quiet 90d · ${row.totalAllTime.toLocaleString()} lifetime`;
  }
  if (row.readRate === 0 && row.last90dMessages >= 8) {
    return `Never opened · ${row.last90dMessages} in last 90d`;
  }
  if (row.readRate < 0.2) return `${pct}% read · ${row.last90dMessages} in last 90d`;
  if (row.readRate >= 0.7) return `${pct}% read · keep close`;
  return `${pct}% read · ${row.last90dMessages} in last 90d`;
}

/**
 * One row in the triage queue (D36 — collapse/expand pattern).
 *
 * Collapsed: avatar, name, domain, verdict pill, one-line why,
 * recommended-verb hint. Click the row (or hit space/enter when
 * focused) to expand.
 *
 * Expanded: the toolbar (K/A/U/L per D29 / D227) becomes visible,
 * the row body extends with the stats grid + reasoning + signals
 * (via `<TriageRowExpanded>`), and if a pending action is open in
 * inline-preview mode the pure preview strip mounts beneath
 * the toolbar.
 *
 * Per D198 / D36 only one row is expanded at a time — the
 * `expanded` flag is driven from the feature's Zustand store so the
 * queue and the action sheet can both read it.
 *
 * Mobile (D37, ≤xs): the card goes vertical — the four verb buttons
 * render full-width at the bottom even while collapsed, and swipe
 * gestures (→ Keep, ← Archive, ↑ Later; see `use-swipe-verb.ts`)
 * augment them. Unsubscribe stays button-only. Swipes route through
 * the same onAction path, so D226's preview still gates every
 * destructive verb.
 */
export function TriageRow({
  row,
  expanded,
  busy = false,
  hero = false,
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
   * the K/A/U/L shortcuts release until the server confirms.
   */
  busy?: boolean;
  /**
   * D26 — the queue's FIRST card is the triage hero: the engine's
   * reasoning renders inline under the why-line while collapsed
   * (1–2 lines, "premium, transparent"). Every other surface keeps
   * reasoning behind an interaction (the expanded body here; the
   * `Why?` popover on Sender Detail).
   */
  hero?: boolean;
  onToggleExpand: () => void;
  onAction: (verb: ActionVerb) => void;
  /**
   * If present, the inline preview strip renders inside the
   * expanded row body — the D34 remember-preference path where the
   * sheet is suppressed but D226's preview is still mandatory.
   */
  inlinePreview?: {
    verb: ActionVerb;
    archiveHistoric: boolean;
    inboxCount: PreviewCount;
    wakeAt?: string | null;
  } | null;
  /** Authenticated queues inject the active Gmail account note; public demos omit it. */
  inlinePreviewAccountContext?: ReactNode;
}) {
  const recommendedVerb: ActionVerb | null =
    row.confidence > 0.85 ? verdictToVerb(row.verdict) : null;
  const inlineConfirmBlocked =
    inlinePreview != null &&
    (inlinePreview.verb === 'Archive' ||
      inlinePreview.verb === 'Later' ||
      (inlinePreview.verb === 'Unsubscribe' && inlinePreview.archiveHistoric)) &&
    typeof inlinePreview.inboxCount !== 'number';
  const actionsDisabled = busy || inlineConfirmBlocked;

  // W1 (2026-07-02 audit) — below the xs ceiling the single-row grid's
  // auto columns (verdict pill + Recommended hint) consume the full
  // viewport and the identity cell (`minmax(0, 1fr)`) collapses to
  // zero width: avatar + chip render, sender name/domain vanish. At
  // ≤480px the header stacks instead — identity keeps the full track
  // on row 1, the pill moves to row 2, and the Recommended hint drops
  // (the pill's "· NN%" already carries the recommendation).
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
        background: color.card,
        border: `1px solid ${expanded ? color.primaryBorder : color.line}`,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: expanded
          ? '0 8px 24px -8px rgba(20,30,50,0.10), 0 2px 6px -2px rgba(20,30,50,0.05)'
          : '0 1px 2px rgba(20,30,50,0.04)',
        transition: 'border-color 0.15s, box-shadow 0.15s, opacity 0.15s',
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
            : '32px minmax(0, 1fr) auto auto 18px',
          gap: 12,
          alignItems: 'center',
          padding: '12px 14px',
          cursor: 'pointer',
          background: expanded ? 'rgba(0,107,95,0.04)' : 'transparent',
        }}
        onMouseEnter={(e) => {
          if (!expanded) e.currentTarget.style.background = 'rgba(14,20,19,0.018)';
        }}
        onMouseLeave={(e) => {
          if (!expanded) e.currentTarget.style.background = 'transparent';
        }}
      >
        <Avatar name={row.senderName} domain={row.senderDomain} size={32} />

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span
              title={row.senderName}
              style={{
                fontWeight: 600,
                fontSize: 14,
                letterSpacing: '-0.005em',
                color: color.fg,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {row.senderName}
            </span>
            {row.protectionReason !== null && (
              <span
                title="Protected — destructive verbs are disabled for this sender"
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
            title={row.senderDomain}
            style={{
              fontFamily: font.mono,
              fontSize: 10.5,
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
              fontSize: 12,
              color: color.fgSoft,
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {whyLine(row)}
          </span>
          {/* D26 — hero card only: the engine's reasoning inline,
              clamped to 2 lines. Hidden while expanded (the expanded
              body renders the same copy in its Reasoning block). */}
          {hero && !expanded && (
            <span
              data-dm-hero-reasoning
              style={{
                fontSize: 12,
                color: color.fgMuted,
                marginTop: 2,
                lineHeight: 1.45,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {row.reasoning}
            </span>
          )}
        </div>

        {/* Verdict pill — the engine's current recommendation. On the
            stacked narrow layout it moves to its own row under the
            identity block (W1). */}
        <Pill
          tone={VERDICT_TONE[row.verdict]}
          style={isNarrow ? { gridColumn: 2, gridRow: 2, justifySelf: 'start' } : {}}
        >
          {verdictToVerb(row.verdict)}
          {/* A protected row's recommendation is Keep BECAUSE of the
              protection, not because of engine confidence — the raw
              confidence belongs to the suppressed verdict, so showing
              it here would mislead (2026-07-10: "Keep · 95%" where 95%
              was the unsubscribe confidence). */}
          {row.protectionReason !== null ? (
            <span style={{ fontFamily: font.mono, fontSize: 9.5, opacity: 0.85 }}>
              {' · '}protected
            </span>
          ) : (
            recommendedVerb !== null && (
              <span style={{ fontFamily: font.mono, fontSize: 9.5, opacity: 0.85 }}>
                {' · '}
                {Math.round(row.confidence * 100)}%
              </span>
            )
          )}
        </Pill>

        {/* Recommended verb hint — only when D31 highlight applies.
            Dropped from the stacked narrow layout: the pill's "· NN%"
            carries the recommendation and the hint's auto column is
            exactly what crushed the identity cell (W1). */}
        {!isNarrow && (
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: recommendedVerb !== null ? color.primary : color.fgMuted,
              visibility: recommendedVerb !== null ? 'visible' : 'hidden',
            }}
            aria-hidden={recommendedVerb === null}
          >
            Recommended
          </span>
        )}

        {/* Chevron — rotates to indicate expand state. Pinned to the
            first row's trailing column on the stacked layout. */}
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: color.fgMuted,
            fontFamily: font.mono,
            fontSize: 14,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
            ...(isNarrow ? { gridColumn: 3, gridRow: 1 } : null),
          }}
        >
          ›
        </span>
      </div>

      {/* D37 mobile card — the four verb buttons render full-width at
          the bottom of the card, collapsed AND expanded (the desktop
          toolbar only mounts on expand). Keyboard is EXPANDED-ROW ONLY:
          every narrow row mounts a toolbar, so an unconditional
          keyboardEnabled put one window keydown listener PER ROW — a
          single 'K' press dispatched Keep for the whole queue
          (2026-07-16 audit). Buttons stay live on collapsed rows;
          only the key listener is gated. */}
      {isNarrow && (
        <div style={{ padding: expanded ? '12px 14px 0' : '0 14px 12px' }}>
          <ActionToolbar
            row={row}
            onAction={onAction}
            keyboardEnabled={expanded && !actionsDisabled}
            disabled={actionsDisabled}
          />
          {/* D37 hint layer — gestures are invisible without it. */}
          <div
            aria-hidden="true"
            style={{
              marginTop: 6,
              fontFamily: font.mono,
              fontSize: 9.5,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: color.fgMuted,
              textAlign: 'center',
            }}
          >
            Swipe · → Keep · ← Archive · ↑ Later
          </div>
        </div>
      )}

      {/* Expanded body — toolbar + stats + reasoning + (maybe) inline preview. */}
      {expanded && (
        <div id={`triage-row-body-${row.id}`} style={{ display: 'flex', flexDirection: 'column' }}>
          {!isNarrow && (
            <div style={{ padding: '12px 14px 0' }}>
              <ActionToolbar
                row={row}
                onAction={onAction}
                keyboardEnabled={!actionsDisabled}
                disabled={actionsDisabled}
              />
            </div>
          )}
          <TriageRowExpanded row={row} />
          {inlinePreview != null && (
            <div style={{ padding: '0 18px 18px' }}>
              <ActionPreviewPresentation
                verb={inlinePreview.verb}
                row={row}
                archiveHistoric={inlinePreview.archiveHistoric}
                inboxCount={inlinePreview.inboxCount}
                wakeAt={inlinePreview.wakeAt ?? null}
                mode="inline"
                accountContext={inlinePreviewAccountContext}
              />
              {/* Explicit confirm affordance (2026-07-16 audit): before
                  this bar, confirming meant an UNDOCUMENTED second click
                  on the same verb — users read the preview and believed
                  the action fired. The button routes through the same
                  onAction path, so the screen's same-verb confirm logic
                  is unchanged. */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 10,
                }}
              >
                <Button tone="primary" size="sm" onClick={() => onAction(inlinePreview.verb)}>
                  Confirm {inlinePreview.verb}
                </Button>
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: 11,
                    color: color.fgMuted,
                  }}
                >
                  or press {VERB_SHORTCUT[inlinePreview.verb]} again · Esc cancels
                </span>
              </div>
            </div>
          )}
        </div>
      )}
      {/* D37 — live gesture feedback: while a touch drag would resolve
          to a verb, name it over the card so releasing is informed. */}
      {drag?.wouldResolve != null && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.82)',
            backdropFilter: 'blur(1px)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: drag.wouldResolve === 'Keep' ? color.primary : color.fg,
            }}
          >
            {drag.wouldResolve === 'Keep'
              ? '→ Keep'
              : drag.wouldResolve === 'Archive'
                ? '← Archive'
                : '↑ Later'}
          </span>
        </div>
      )}
      {/* SR announcement while the decision confirms server-side. */}
      {busy && (
        <span role="status" style={{ position: 'absolute', left: -9999 }}>
          Applying your decision for {row.senderName}
        </span>
      )}
    </div>
  );
}
