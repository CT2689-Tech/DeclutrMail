'use client';

import { Avatar, Button, Pill, tokens, useIsAtMost } from '@declutrmail/shared';
import {
  confidenceBand,
  normalizeProtectionReason,
  protectionReasonLabel,
  scoredAgeLabel,
} from '@declutrmail/shared/copy';
import { useNow } from '@/lib/use-now';
import type { PillTone } from '@declutrmail/shared';
import type { ReactNode } from 'react';

import { ActionPreviewPresentation, type PreviewCount } from './action-preview-presentation';
import { ActionToolbar } from './action-toolbar';
import { canArchive, canLater, type TriageDecisionRow } from './data';
import { ProtectedActionNotice, UnprotectButton } from './protected-notice';
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
 * The EXACT reason a sender is Protected (CLAUDE.md §2.6 / D245), in
 * the user's own terms. One shared source across Screener, Triage,
 * Sender Detail and the Settings policies list — this used to be four
 * hand-written copies that had already drifted.
 */
function protectionEvidence(row: TriageDecisionRow): string {
  // A shield whose evidence no longer holds must not keep asserting it
  // — the D245 review names those rows in its own header, so repeating
  // the old reason here makes the screen contradict itself. Only an
  // explicit `false` does this: `null`/`undefined` mean unmeasurable,
  // which is not a contradiction.
  if (row.protectionEvidenceCurrent === false) {
    return 'Protected · we can no longer confirm you wrote to them';
  }
  return protectionReasonLabel(normalizeProtectionReason(row.protectionReason));
}

/**
 * Tight one-line "why" for the collapsed row (D36 — critical info
 * default). Uses `last90dMessages` instead of the derived
 * `monthlyVolume = round(last90 / 3)` so a sender that mailed twice in
 * the last 90d reads as "2 in last 90d", not "0/mo" — the lie pattern
 * founder caught 2026-06-06 (same class as Sender Detail Bug 3).
 *
 * Quiet senders (no mail in 90d but real indexed history) get an
 * explicit "Quiet 90d" copy instead of a fabricated "0/mo".
 */
function whyLine(row: TriageDecisionRow): string {
  if (row.protectionReason !== null) {
    const evidence = protectionEvidence(row);
    // What the protection is holding back. On the D245 review this is
    // the ranking key, so it has to be visible on the collapsed row —
    // otherwise the order looks arbitrary. Omitted at zero rather than
    // printed as "shielding 0 unread": there is nothing in the inbox to
    // shield, and a measurement of nothing reads as a measurement.
    // Narrowed through a local so the "shielding N" clause is
    // structurally unreachable when the wire omitted the measure —
    // absent is unknown, not zero, and both render as just the
    // evidence.
    const shielded = row.unreadInboxCount;
    return shielded != null && shielded > 0
      ? `${evidence} · shielding ${shielded.toLocaleString('en-US')} unread`
      : evidence;
  }
  if (row.last90dMessages === 0) {
    // Quiet within the rolling window — say so plainly. Received total
    // carries the "they DID mail you" context without faking cadence.
    return `Quiet 90d · ${row.totalAllTime.toLocaleString('en-US')} received`;
  }
  if (row.readRate === null) {
    // No denominator, so no rate. Reachable independently of the quiet
    // branch above (the BE derives them from different windows), and a
    // fabricated "0% read" here would read as "never opened".
    return `${row.last90dMessages} in last 90d`;
  }
  const pct = Math.round(row.readRate * 100);
  // Two separate honesty constraints on this phrase.
  //
  // WINDOW: every phrase below names 90 days, because `readRate` IS a
  // 90-day ratio (`triage.read-service.ts` — `last90Read / last90Total`).
  // This said "Never opened", an absolute lifetime claim built from 90
  // days, on the product's core ritual. A sender the user has read for
  // years reads as never opened after one quiet quarter.
  //
  // VERB: "marked read", never "opened". Gmail exposes only the absence
  // of the UNREAD label and no open event at all, so we cannot tell a
  // human reading a message from a Gmail filter, a bulk mark-as-read, or
  // a third-party sweeper (unroll.me, SaneBox) stripping UNREAD over the
  // API. D45 settled this — the column is UNREAD-derived and "could
  // never be populated honestly" as opens — and `sender-card.tsx` states
  // the rule outright. The first pass at this fix corrected the window
  // and kept the banned verb.
  if (row.readRate === 0 && row.last90dMessages >= 8) {
    return `None marked read in 90d · ${row.last90dMessages} messages`;
  }
  // "marked read", not "read" — the same rule the zero branch above
  // already followed and these three did not. Gmail exposes only the
  // absence of the UNREAD label, which a filter, a bulk mark-as-read or
  // a third-party sweeper can strip without a human seeing anything
  // (D45). "% read" claims the human; "% marked read" claims the label.
  if (row.readRate < 0.2) return `${pct}% marked read in 90d · ${row.last90dMessages} messages`;
  if (row.readRate >= 0.7) return `${pct}% marked read in 90d · keep close`;
  return `${pct}% marked read in 90d · ${row.last90dMessages} messages`;
}

/**
 * One row in the triage queue (D36 — collapse/expand pattern).
 *
 * Collapsed: avatar, name, domain, verdict pill, one-line why,
 * confidence band. Click the row (or hit space/enter when
 * focused) to expand.
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
  offerUnprotect = false,
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
   * D26 — the queue's FIRST card is the triage hero: the engine's
   * reasoning renders inline under the why-line while collapsed
   * (1–2 lines, "premium, transparent"). Every other surface keeps
   * reasoning behind an interaction (the expanded body here; the
   * `Why?` popover on Sender Detail).
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
  // The engine's confidence, as one word on the verdict pill. The row
  // used to print this twice — the pill's band AND a standalone
  // `Recommended` hint, which said the same thing because `strong` IS
  // `isRecommended`. The hint also cost an `auto` grid column, which is
  // what crushed the identity cell below 480px (W1) and forced the two
  // layouts to disagree about what a row shows. One badge, both widths.
  const band = confidenceBand(row.verdict, row.confidence);
  // Hydration-safe clock — see the note in `triage-row-expanded.tsx`.
  // `null` on the server and the first client render, so the label
  // appears one tick after mount rather than mismatching.
  const now = useNow();
  const ageLabel =
    row.scoredAt !== undefined && now !== null ? scoredAgeLabel(row.scoredAt, new Date(now)) : null;
  const inlineConfirmBlocked =
    inlinePreview != null &&
    (inlinePreview.verb === 'Archive' ||
      inlinePreview.verb === 'Later' ||
      inlinePreview.verb === 'Delete' ||
      (inlinePreview.verb === 'Unsubscribe' && inlinePreview.archiveHistoric)) &&
    typeof inlinePreview.inboxCount !== 'number';
  const actionsDisabled = busy || inlineConfirmBlocked;

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
            : '32px minmax(0, 1fr) auto 18px',
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
        <Avatar name={row.senderName} domain={row.senderDomain} size={32} hasMark={row.brandMark} />

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
              body renders the same explanation). */}
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
          {/* The hero is the one collapsed row that prints the engine's
              sentence, so it is the one place the sentence sits directly
              under a why-line built from LIVE stats. The sentence quotes
              the numbers as they were at score time; a card reading
              "60 messages monthly, 1% read rate" above "0% read in 90d ·
              209 messages" is those two clocks colliding (founder,
              2026-08-19). The age is what makes it one coherent card
              instead of a contradiction. */}
          {hero && !expanded && ageLabel !== null && (
            <span
              data-dm-hero-scored-age
              style={{
                fontFamily: font.mono,
                fontSize: 9.5,
                color: color.fgMuted,
                marginTop: 3,
              }}
            >
              {ageLabel}
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
          {/* No `opacity` here. The Pill's tone colours are AA-compliant
              on their own tint (teal 5.70:1, amber 4.65:1), but dimming
              them to 0.85 blends them toward the background and drops
              this 9.5px text to 4.27:1 / 3.63:1 — under the 4.5:1 floor.
              axe flagged it on /inbox-simulator, the one public page
              that renders a triage row. The suffix is already
              de-emphasised by being mono and smaller; it does not need
              the opacity as well. */}
          {row.protectionReason !== null ? (
            <span style={{ fontFamily: font.mono, fontSize: 9.5 }}>{' · '}protected</span>
          ) : (
            band !== null && (
              <span style={{ fontFamily: font.mono, fontSize: 9.5 }}>
                {' · '}
                {band}
              </span>
            )
          )}
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

      {/* The D245 safety state, changeable in place. Deliberately its
          OWN strip rather than a sixth button in the verb toolbar: the
          verbs decide what happens to this sender's email, Unprotect
          decides whether cleanup may reach them at all, and putting the
          two in one row is what made an earlier draft bundle them. Only
          the protection review asks for it — daily Triage keeps the
          notice inside the preview, where the user is already acting. */}
      {offerUnprotect && row.protectionReason !== null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            padding: '10px 14px',
            borderTop: `1px solid ${color.line}`,
            background: color.mutedBg,
          }}
        >
          {/* NOT the reason — the why-line above already carries that,
              and repeating it made every row say "you starred a
              message" twice. What is missing there is the CONSEQUENCE,
              which is the whole reason this control exists. */}
          <span style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.45 }}>
            Bulk and automatic cleanup skip this sender.
          </span>
          {/* The strip only renders on the D245 review (`offerUnprotect`),
              so this surface is the review, not daily Triage. */}
          <UnprotectButton row={row} surface="onboarding-review" />
        </div>
      )}

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
        </div>
      )}

      {/* The D226 preview is MANDATORY while an action is pending, so it
          renders on `inlinePreview` alone — never on `expanded`. It used
          to live inside the expanded body, which made it dismissable:
          collapsing the row unmounted the preview (and its Protected
          acknowledgement) while the pending action survived and, on
          narrow widths, the verb toolbar stayed live on the collapsed
          card. A preview a tap can hide is an optional preview. */}
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
          {/* Protected acknowledgement (D245/D42) — the inline half of
                  the same statement the sheet makes. D226 lets the sheet
                  be skipped via D34's remember-preference, but the preview
                  always renders, so the override must be named on BOTH
                  paths or skipping the sheet silently skips the notice.
                  `triage-screen.tsx` sends `override: true` for this row. */}
          {row.protectionReason != null && (
            <div style={{ marginTop: 10 }}>
              {/* Keep moves no mail, so it has no reach sentence — the
                  notice still states that protection persists. In
                  practice Keep never opens a preview; narrowing rather
                  than casting keeps that a fact the type carries. */}
              <ProtectedActionNotice
                row={row}
                verb={inlinePreview.verb === 'Keep' ? null : inlinePreview.verb}
                surface="triage-preview"
                // The D245 review's row strip already renders one; without
                // this, a protected row with D34's remember-preference set
                // stacks two identical Unprotect buttons and two
                // overlapping sentences on the same card.
                showUnprotect={!offerUnprotect}
              />
            </div>
          )}
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
            {/* Fail closed exactly like the sheet does (action-sheet's
                `confirmDisabled`): `inlineConfirmBlocked` is true while a
                email-moving verb's live count has not resolved, and `busy`
                while an action is in flight. This button ignored both, so
                the inline path could confirm a mutation before D226's
                mandatory preview had produced a number — the one thing the
                preview exists to prevent. */}
            <Button
              tone={inlinePreview.verb === 'Delete' ? 'danger' : 'primary'}
              size="sm"
              disabled={actionsDisabled}
              onClick={() => onAction(inlinePreview.verb)}
            >
              Confirm {inlinePreview.verb}
              {row.protectionReason != null ? ' anyway' : ''}
            </Button>
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 11,
                color: color.fgMuted,
              }}
            >
              {/* Only advertise the shortcut where it actually fires.
                  The verb keydown lives on ActionToolbar: on desktop the
                  toolbar mounts only inside the expanded body, and on
                  narrow widths it mounts on collapsed cards but with
                  `keyboardEnabled={expanded && ...}` — so "press A again"
                  is false on a collapsed row either way. Escape is
                  different: it is a window listener in triage-screen
                  gated only on the pending inline surface, so it stays
                  true whether the row is open or closed. */}
              {expanded && !actionsDisabled ? (
                <>or press {VERB_SHORTCUT[inlinePreview.verb]} again · Esc cancels</>
              ) : (
                <>Esc cancels</>
              )}
            </span>
          </div>
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
