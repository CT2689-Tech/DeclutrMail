'use client';

import { Button, Disclosure, SheetFactList, tokens } from '@declutrmail/shared';
import { isPluralCopy, pluralCopy, WS2_COPY, WS5_COPY } from '@declutrmail/shared/copy/launch';
import type { ReactNode } from 'react';
import {
  CleanupImpact,
  CleanupPreview,
  type CleanupAgeControl,
} from '@/components/cleanup-preview';

import { MeterPreviewLine } from '@/features/billing/meter-preview-line';
import { useCleanupSummary } from '@/features/billing/use-cleanup-summary';
import type { UnsubscribeBacklogMode } from '@/features/senders/unsubscribe-backlog/preview-copy';

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
  ageControl?: CleanupAgeControl | undefined;
  verb: ActionVerb;
  archiveHistoric: boolean;
  /** Skip-sheet unsubscribe choice. Archive is the default when the inbox count is above zero. */
  backlogMode?: UnsubscribeBacklogMode | undefined;
  onBacklogMode?: ((mode: UnsubscribeBacklogMode) => void) | undefined;
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
  onCancel?: (() => void) | undefined;
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
      (movesInbox ||
        (preview.verb === 'Unsubscribe' &&
          (preview.archiveHistoric ||
            (preview.backlogMode !== undefined && preview.backlogMode !== 'unsub_only')))) &&
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
  const backlogMode =
    preview.verb === 'Unsubscribe'
      ? (preview.backlogMode ?? (preview.archiveHistoric ? 'archive' : 'unsub_only'))
      : 'unsub_only';
  const facts = buildPreviewFacts({
    olderThanDays: preview.verb === 'Archive' ? (preview.ageControl?.olderThanDays ?? null) : null,
    verb: preview.verb,
    row,
    archiveHistoric: preview.archiveHistoric || backlogMode === 'archive',
    ...(preview.verb === 'Unsubscribe' ? { backlogMode } : {}),
    inboxCount: preview.inboxCount,
    wakeAt: preview.wakeAt ?? null,
  });
  const cleanupSummary = useCleanupSummary();
  const emailMeter = cleanupSummary.data?.metered === true;
  const costLine =
    emailMeter || facts.unitsNeeded === 0
      ? null
      : cleanupCostLine(facts.unitsNeeded, preview.quotaRemaining);
  const countKnown = typeof preview.inboxCount === 'number' ? preview.inboxCount : null;
  const hasDetails = facts.disclosures.length > 0 || preview.detailSlot != null;
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
      {accountContext != null && <div style={{ marginBottom: space[3] }}>{accountContext}</div>}
      <h3 style={{ ...tokens.typography.dialogTitle, margin: 0, color: color.fg }}>
        {preview.verb === 'Archive' && !facts.nothingToMove
          ? `Archive emails from ${row.senderName}?`
          : facts.title}
      </h3>
      {preview.verb !== 'Archive' && facts.subtitle && (
        <p
          style={{
            margin: `${space[2]}px 0 0`,
            fontSize: text.md,
            lineHeight: 1.5,
            color: color.fgSoft,
            textWrap: 'balance',
          }}
        >
          {facts.subtitle}
        </p>
      )}
      {/* Why confirm is disabled while the live count is not a number —
          the same two lines the sheet's status shows. A disabled button
          with no reason reads as a broken one. */}
      {blocked && (
        <p style={{ margin: `${space[1]}px 0 0`, fontSize: text.sm, color: color.fgMuted }}>
          {preview.inboxCount === 'unavailable'
            ? WS2_COPY.preview.loadFailed
            : WS5_COPY['f1.preview.backlog.loading']}
        </p>
      )}
      {preview.verb !== 'Archive' && facts.note !== null && (
        <p style={{ margin: `${space[1]}px 0 0`, fontSize: text.sm, color: color.fgMuted }}>
          {facts.note}
        </p>
      )}
      {preview.verb === 'Unsubscribe' ? (
        <div role="radiogroup" aria-label={WS5_COPY['f1.segment.unsubOnly']}>
          <InlineBacklogChoice
            checked={backlogMode === 'unsub_only'}
            label={WS5_COPY['f1.segment.unsubOnly']}
            onSelect={() => preview.onBacklogMode?.('unsub_only')}
          />
          <InlineBacklogChoice
            checked={backlogMode === 'archive'}
            disabled={countKnown === null || countKnown === 0}
            label={
              isPluralCopy(WS5_COPY['f1.segment.archive'])
                ? pluralCopy(WS5_COPY['f1.segment.archive'], countKnown ?? 0, {
                    n: countKnown ?? 0,
                  })
                : ''
            }
            onSelect={() => preview.onBacklogMode?.('archive')}
          />
          <InlineBacklogChoice
            checked={backlogMode === 'delete'}
            disabled={countKnown === null || countKnown === 0}
            label={
              isPluralCopy(WS5_COPY['f1.segment.delete'])
                ? pluralCopy(WS5_COPY['f1.segment.delete'], countKnown ?? 0, { n: countKnown ?? 0 })
                : ''
            }
            onSelect={() => preview.onBacklogMode?.('delete')}
          />
          {emailMeter && backlogMode !== 'unsub_only' ? <p>{WS5_COPY['f1.meterFree']}</p> : null}
          {emailMeter && backlogMode !== 'unsub_only' && cleanupSummary.data ? (
            <MeterPreviewLine requested={countKnown ?? 0} summary={cleanupSummary.data} />
          ) : null}
          <p>
            {WS5_COPY['f1.footer']}
            {backlogMode === 'delete' ? ` ${WS5_COPY['f1.deleteNote']}` : ''}
          </p>
        </div>
      ) : null}
      {costLine !== null && (
        <p style={{ margin: `${space[1]}px 0 0`, fontSize: text.sm, color: color.fgMuted }}>
          {costLine}
        </p>
      )}
      {emailMeter &&
      preview.verb !== 'Unsubscribe' &&
      cleanupSummary.data &&
      typeof preview.inboxCount === 'number' &&
      preview.inboxCount > 0 ? (
        <MeterPreviewLine requested={preview.inboxCount} summary={cleanupSummary.data} />
      ) : null}
      {preview.verb === 'Archive' && preview.ageControl && (
        <CleanupPreview
          olderThanDays={preview.ageControl.olderThanDays}
          options={preview.ageControl.options}
          onWindowChange={preview.ageControl.onChange}
          showWindow
        >
          {null}
        </CleanupPreview>
      )}
      {hasDetails && (
        <Disclosure style={{ marginTop: space[2] }}>
          <SheetFactList facts={facts.disclosures} />
          {preview.detailSlot}
        </Disclosure>
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
      {preview.verb === 'Archive' && (
        <div style={{ marginTop: space[3] }}>
          <CleanupImpact
            action="Archive"
            count={countKnown}
            includesArchived={false}
            olderThanDays={preview.ageControl?.olderThanDays ?? null}
            note={facts.note ?? ''}
          />
        </div>
      )}
      {/* Explicit confirm affordance (2026-07-16 audit): before this bar,
          confirming meant an UNDOCUMENTED second click on the same verb —
          users read the preview and believed the action fired. Fails
          closed exactly like the sheet does (`confirmDisabled`). */}
      <div className="dm-confirm-footer" style={{ marginTop: space[3] }}>
        {preview.onCancel && (
          <Button tone="ghost" onClick={preview.onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
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
          {row.protectionReason != null && preview.verb !== 'Unsubscribe'
            ? `${preview.verb} anyway`
            : preview.verb === 'Archive'
              ? 'Archive'
              : facts.primaryLabel}
        </Button>
        <span className="dm-key-hint" style={{ fontSize: text.xs, color: color.fgMuted }}>
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

function InlineBacklogChoice({
  checked,
  disabled = false,
  label,
  onSelect,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <label style={{ display: 'flex', gap: 8, minHeight: 44, alignItems: 'center' }}>
      <input
        type="radio"
        name="triage-inline-unsubscribe-backlog"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
      />
      {label}
    </label>
  );
}
