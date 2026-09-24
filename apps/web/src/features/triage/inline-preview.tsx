'use client';

import { Button, SheetFactList, tokens } from '@declutrmail/shared';
import type { ReactNode } from 'react';

import {
  buildPreviewFacts,
  cleanupCostLine,
  type PreviewCount,
} from './action-preview-presentation';
import type { TriageDecisionRow } from './data';
import { ProtectedActionNotice } from './protected-notice';
import { VERB_SHORTCUT, type ActionVerb } from './types';

const { color, radius, space, text } = tokens;

/**
 * The D34 remember-preference path: the sheet is suppressed but D226's
 * preview is still mandatory, so it renders in place — inside the list
 * row or the focus card.
 */
export interface InlinePreview {
  verb: ActionVerb;
  archiveHistoric: boolean;
  /**
   * Rendered D226 verification detail, built by the authenticated
   * caller.
   *
   * A NODE, and built one level up, because the public inbox simulator
   * imports the row: importing the detail block here put its code in the
   * simulator's route chunk and pushed it over budget. Same reason
   * `accountContext` below is a node rather than a flag.
   */
  detailSlot?: ReactNode | undefined;
  quotaRemaining?: number | null | undefined;
  inboxCount: PreviewCount;
  wakeAt?: string | null;
}

/**
 * Whether the pending inline action may confirm.
 *
 * `blocked` — a mail-moving verb's live count has not resolved: no
 * mutation before D226's mandatory preview has produced a number.
 *
 * `nothingToActOn` — the count resolved to zero, which makes an
 * inbox-moving verb a no-op that still costs a cleanup action on Free.
 * `triage-screen.tsx` refuses that dispatch (`inlinePreviewBlocked`), so
 * without this the button renders armed and a click does nothing
 * visible. Unsubscribe is excluded exactly as it is in the sheet — it
 * cuts FUTURE mail.
 */
export function inlinePreviewGates(preview: InlinePreview | null | undefined): {
  blocked: boolean;
  nothingToActOn: boolean;
} {
  if (preview == null) return { blocked: false, nothingToActOn: false };
  const movesInbox =
    preview.verb === 'Archive' || preview.verb === 'Later' || preview.verb === 'Delete';
  return {
    blocked:
      (movesInbox || (preview.verb === 'Unsubscribe' && preview.archiveHistoric)) &&
      typeof preview.inboxCount !== 'number',
    nothingToActOn: movesInbox && preview.inboxCount === 0,
  };
}

/**
 * The preview is MANDATORY while an action is pending, so callers render
 * this on `preview` alone — never behind an expand/disclosure state. It
 * used to live inside the expanded row body, which made it dismissable:
 * collapsing the row unmounted the preview (and its Protected
 * acknowledgement) while the pending action survived. A preview a tap
 * can hide is an optional preview.
 */
export function InlinePreviewBlock({
  row,
  preview,
  busy,
  shortcutLive,
  accountContext,
  unprotectSlot,
  onConfirm,
}: {
  row: TriageDecisionRow;
  preview: InlinePreview;
  busy: boolean;
  /**
   * Whether the verb keydown is bound for this row right now. Only
   * advertise the shortcut where it actually fires: the listener lives
   * on `ActionToolbar`, which mounts with the expanded list row and the
   * focus card. Escape is different — a window listener in
   * triage-screen gated only on the pending inline surface — so it is
   * offered either way.
   */
  shortcutLive: boolean;
  /** Authenticated queues inject the active Gmail account note; public demos omit it. */
  accountContext?: ReactNode;
  unprotectSlot?: ReactNode;
  /** Routes through the same onAction path as the verb, so the screen's same-verb confirm logic is unchanged. */
  onConfirm: () => void;
}) {
  const { blocked, nothingToActOn } = inlinePreviewGates(preview);
  // Confirm ONLY. Switching to a different verb stays live, as it does in
  // the sheet where `confirmDisabled` gates the button and nothing else —
  // a zero Archive count must not trap the row out of Delete or Later.
  const confirmDisabled = busy || blocked || nothingToActOn;
  // Same facts as the sheet (`buildPreviewFacts`), laid out as one line:
  // count + where it goes, then how to undo it. Everything the sheet keeps
  // behind "Details" stays behind a disclosure here too.
  const facts = buildPreviewFacts({
    verb: preview.verb,
    row,
    archiveHistoric: preview.archiveHistoric,
    inboxCount: preview.inboxCount,
    wakeAt: preview.wakeAt ?? null,
  });
  const costLine = cleanupCostLine(facts.unitsNeeded, preview.quotaRemaining);
  const hasDetails =
    accountContext != null || facts.disclosures.length > 0 || preview.detailSlot != null;
  return (
    <div
      role="region"
      aria-label={`Preview · ${preview.verb} ${row.senderName}`}
      data-dm-preview-mode="inline"
      style={{
        textAlign: 'left',
        padding: space[4],
        borderRadius: radius.lg,
        background: color.fill,
      }}
    >
      <p style={{ margin: 0, fontSize: text.md, fontWeight: 600, color: color.fg }}>
        {facts.nothingToMove ? facts.title : facts.compactLine}
      </p>
      {/* Why confirm is disabled while the live count is not a number —
          the same two lines the sheet's status shows. A disabled button
          with no reason reads as a broken one. */}
      {blocked && (
        <p style={{ margin: `${space[1]}px 0 0`, fontSize: text.sm, color: color.fgMuted }}>
          {preview.inboxCount === 'unavailable'
            ? 'Couldn’t load the preview. Nothing can move until it loads.'
            : 'Counting the inbox…'}
        </p>
      )}
      {facts.note !== null && (
        <p style={{ margin: `${space[1]}px 0 0`, fontSize: text.sm, color: color.fgMuted }}>
          {facts.note}
        </p>
      )}
      {costLine !== null && (
        <p style={{ margin: `${space[1]}px 0 0`, fontSize: text.sm, color: color.fgMuted }}>
          {costLine}
        </p>
      )}
      {hasDetails && (
        <details style={{ marginTop: space[2] }}>
          <summary
            style={{ cursor: 'pointer', fontSize: text.sm, fontWeight: 550, color: color.fgSoft }}
          >
            Details
          </summary>
          <div
            style={{
              marginTop: space[2],
              display: 'flex',
              flexDirection: 'column',
              gap: space[2],
              fontSize: text.sm,
              color: color.fg,
            }}
          >
            {accountContext}
            <SheetFactList facts={facts.disclosures} />
            {preview.detailSlot}
          </div>
        </details>
      )}
      {/* Protected acknowledgement (D245/D42) — the inline half of the
          same statement the sheet makes. D226 lets the sheet be skipped
          via D34's remember-preference, but the preview always renders,
          so the override must be named on BOTH paths or skipping the
          sheet silently skips the notice. `triage-screen.tsx` sends
          `override: true` for this row. */}
      {row.protectionReason != null && (
        <div style={{ marginTop: 10 }}>
          {/* Keep moves no mail, so it has no reach sentence — the notice
              still states that protection persists. In practice Keep
              never opens a preview; narrowing rather than casting keeps
              that a fact the type carries. */}
          <ProtectedActionNotice
            row={row}
            verb={preview.verb === 'Keep' ? null : preview.verb}
            unprotectSlot={unprotectSlot}
          />
        </div>
      )}
      {/* Explicit confirm affordance (2026-07-16 audit): before this bar,
          confirming meant an UNDOCUMENTED second click on the same verb —
          users read the preview and believed the action fired. Fails
          closed exactly like the sheet does (`confirmDisabled`). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: space[3] }}>
        <Button
          tone={
            preview.verb === 'Delete'
              ? 'danger'
              : preview.verb === 'Unsubscribe'
                ? 'warn'
                : 'primary'
          }
          size="md"
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {row.protectionReason != null ? `${preview.verb} anyway` : facts.primaryLabel}
        </Button>
        <span style={{ fontSize: text.xs, color: color.fgMuted }}>
          {/* A zero count is the third case: the screen refuses that
              dispatch, so no key fires it either. */}
          {nothingToActOn ? (
            <>Esc cancels</>
          ) : shortcutLive && !busy && !blocked ? (
            <>Press {VERB_SHORTCUT[preview.verb]} again to confirm · Esc cancels</>
          ) : (
            <>Esc cancels</>
          )}
        </span>
      </div>
    </div>
  );
}
