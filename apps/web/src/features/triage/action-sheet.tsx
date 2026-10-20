'use client';

import { MailboxActionContextView } from '../auth/mailbox-action-context-view';

import { useEffect, useState, type ReactNode } from 'react';
import { Avatar, Button, PreviewSheet, SheetSegmented, tokens } from '@declutrmail/shared';
import { isPluralCopy, pluralCopy, WS2_COPY, WS5_COPY } from '@declutrmail/shared/copy/launch';
import {
  unsubscribeButton,
  unsubscribeTitle,
} from '@/features/senders/unsubscribe-backlog/preview-copy';
import { ActionReachControl, DELETE_ARCHIVED_HINT } from '@/components/action-scope-controls';
import { CleanupImpact } from '@/components/cleanup-preview';
import { buildActionPresentation } from '@declutrmail/shared/actions';
import { MeterPreviewLine } from '@/features/billing/meter-preview-line';
import { useCleanupSummary } from '@/features/billing/use-cleanup-summary';
import type { ActionReach } from '@declutrmail/shared/contracts';
import type { PreviewCount } from './action-preview';
import {
  ActionPreviewDetailBlock,
  actionMovesMail,
  type ActionPreviewDetail,
} from './action-preview-detail';
import { PREVIEW_DETAILS } from '@declutrmail/shared/copy';
import {
  PreviewReasoning,
  buildPreviewFacts,
  cleanupCostLine,
} from './action-preview-presentation';
import type { TriageDecisionRow } from './data';
import { ProtectedActionNotice } from './protected-notice';
import type { SheetableVerb } from './store';

const { color, font, radius, shadow, space, text } = tokens;

export interface ConfirmDetails {
  archiveHistoric: boolean;
  /** Unsubscribe backlog choice. Archive is the default when the inbox count is above zero. */
  backlogMode?: 'unsub_only' | 'archive' | 'delete';
  /** Exact return time confirmed for Later; null for other verbs. */
  wakeAt: string | null;
  /** Final value of the remember-preference toggle when confirming. */
  rememberPreference: boolean;
  /** Explicit reach for the Unsubscribe + Delete backlog. */
  reach?: ActionReach;
}

/**
 * Triage action sheet (D34) — modal preview before a destructive
 * mutation runs.
 *
 * D34: the sheet shows by default on Archive / Unsubscribe / Later and
 * always for Delete.
 * A "remember my choice" toggle lets the user opt into the
 * preview-inline path; that preference lives in the triage Zustand
 * store (see `store.ts`).
 *
 * D226: this sheet IS the mandatory preview. The sheet is what D34
 * allows skipping; the preview never is — `inline-preview.tsx` renders
 * the same facts (`buildPreviewFacts`) in the row when it is skipped.
 *
 * Archive/Delete use the reviewed PreviewSheet layout: sender title,
 * count/destination and recovery beside the final action. Other verbs
 * retain the compact grammar (ADR-0042); remaining facts stay in Details.
 *
 * Keyboard: Escape cancels (owned by `PreviewSheet`); Cmd/Ctrl-Enter
 * confirms — same shortcuts as `confirm-action-modal.tsx` in the senders
 * feature so muscle memory carries between screens.
 */
export function ActionSheet({
  open,
  verb,
  row,
  inboxCount,
  wakeAt = null,
  mailboxEmail,
  unprotectSlot,
  onCancel,
  onConfirm,
  onRetryPreview,
  previewSenderGone = false,
  onRefreshTriage,
  detail,
  reach = 'inbox_only',
  onReachChange,
  quotaRemaining,
}: {
  open: boolean;
  /** Sheetable verbs only — Keep is never previewed. */
  verb: SheetableVerb;
  row: TriageDecisionRow | null;
  /** Live inbox count for the preview's impact figure (D226). */
  inboxCount: PreviewCount;
  wakeAt?: string | null;
  /** Explicit override for isolated previews; app surfaces use active auth context. */
  mailboxEmail?: string | undefined;
  /**
   * The Unprotect control, constructed by the caller (see
   * `unprotect-button.tsx`). This sheet stays pure presentation and never
   * imports the sender-policy mutation or the API client behind it, so a
   * route that opens the sheet on a Protected row — the public inbox
   * simulator does — never pulls the authenticated client into its chunk.
   * `undefined` renders the protection notice without a live control.
   */
  unprotectSlot?: ReactNode;
  onCancel: () => void;
  onConfirm: (details: ConfirmDetails) => void;
  onRetryPreview?: (() => void) | undefined;
  previewSenderGone?: boolean | undefined;
  onRefreshTriage?: (() => void) | undefined;
  /** Verification detail for the D226 preview (parity with senders). */
  detail?: ActionPreviewDetail | undefined;
  /** ADR-0028 — the reach a Delete is armed at; `inboxCount` is the count at it. */
  reach?: ActionReach | undefined;
  onReachChange?: ((reach: ActionReach) => void) | undefined;
  /**
   * Cleanup actions left this month; `null` when the tier does not meter
   * them.
   *
   * Its OWN prop, not a field on `detail`. It was a field, and
   * `triage-screen.tsx` returns `detail` as `undefined` until the
   * composite preview resolves — while Unsubscribe with the backlog left
   * alone is the one verb whose confirm does NOT wait for that preview
   * (`requiresLivePreview` below). So the cost went missing at exactly
   * the moment it could be spent. The allowance comes from `auth.me` and
   * never had a reason to wait on a preview at all.
   */
  quotaRemaining?: number | null | undefined;
}) {
  // Unsubscribe defaults to Archive when the inbox count is above zero.
  // The unsubscribe request is free. While the email meter is off, the
  // mail move still spends one cleanup action and the existing unit line
  // stays. Archive and Later ignore a separate historic toggle — both
  // verbs already act on every inbox message from the sender.
  const cleanupSummary = useCleanupSummary();
  const [backlogMode, setBacklogMode] = useState<'unsub_only' | 'archive' | 'delete'>('unsub_only');
  const [rememberPreference, setRememberPreference] = useState(false);
  const [selectedWakeAt, setSelectedWakeAt] = useState<string | null>(wakeAt);
  const actionKey = open && row ? `${verb}:${row.id}` : null;
  const [chosenActionKey, setChosenActionKey] = useState<string | null>(null);
  // The first render of a newly opened Unsubscribe sheet must use its safe
  // default immediately, before the reset effect runs. Otherwise a fast
  // Cmd/Ctrl-Enter could observe the previous action's `false` toggle.
  const countKnown = typeof inboxCount === 'number' ? inboxCount : null;
  const inboxOptionCount =
    countKnown === null ? null : (detail?.reachControl?.inboxCount ?? countKnown);
  const defaultBacklog =
    verb === 'Unsubscribe' &&
    row?.protectionReason == null &&
    inboxOptionCount !== null &&
    inboxOptionCount > 0
      ? 'archive'
      : 'unsub_only';
  const effectiveMode =
    actionKey !== null && chosenActionKey === actionKey ? backlogMode : defaultBacklog;
  const effectiveArchiveHistoric = effectiveMode === 'archive';

  // Archive/Later/Delete always move inbox mail. Unsubscribe only does when the
  // user keeps the backlog option on. Any such action requires the live
  // count to have resolved; loading/failure must fail closed for click and
  // keyboard submission alike.
  const requiresLivePreview =
    verb === 'Archive' ||
    verb === 'Later' ||
    verb === 'Delete' ||
    (verb === 'Unsubscribe' && effectiveMode !== 'unsub_only');
  const previewUnavailable = inboxCount === 'unavailable';
  const previewPending = inboxCount === 'loading';
  const wakeAtInvalid =
    verb === 'Later' && (selectedWakeAt === null || Date.parse(selectedWakeAt) <= Date.now());
  // A mail-moving verb with zero matches is a no-op that still costs a
  // cleanup action on Free. Senders already blocks this (`nothingToActOn`,
  // confirm-action-modal.tsx); triage did not, so the two surfaces disagreed
  // on the same decision.
  // Gate on the PRIMARY verb only. Unsubscribe is deliberately excluded, as
  // it is in senders (`primaryActsOnInbox`): it cuts FUTURE mail, so it is
  // real work at a zero backlog. The unsubscribe itself is free.
  const primaryActsOnInbox = verb === 'Archive' || verb === 'Later' || verb === 'Delete';
  const nothingToActOn = primaryActsOnInbox && inboxCount === 0;
  const archivedUncounted =
    reach === 'all_mail' &&
    detail?.reachControl?.allMailCount === null &&
    detail.reachControl != null &&
    (verb === 'Delete' || (verb === 'Unsubscribe' && effectiveMode === 'delete'));
  const confirmDisabled =
    previewSenderGone ||
    archivedUncounted ||
    (requiresLivePreview && (previewPending || previewUnavailable || inboxCount === 0)) ||
    nothingToActOn ||
    wakeAtInvalid;

  // Acting on a Protected sender. D245 excludes Protected from BULK and
  // AUTOMATIC actions, so this explicit single-row action stays open —
  // but `triage-screen.tsx` sends `override: true` for exactly this row,
  // and an override the user is never told about is the same defect this
  // codebase keeps fixing. Name it here, in the mandatory D226 preview,
  // and say "anyway" on the button that carries it. Protection is usually
  // AUTOMATIC (>=3 replies, a star, repeated Gmail-importance), so the
  // user may not know it is set — which is precisely why it is stated.
  const isProtectedRow = row?.protectionReason != null;

  useEffect(() => {
    if (!open || chosenActionKey !== actionKey) setChosenActionKey(null);
  }, [open, actionKey, chosenActionKey]);

  // Remember and the Later date belong to the action, not the preview.
  // `inboxCount` arrives after the sheet opens; resetting on that change
  // cleared a toggle the user had already checked.
  useEffect(() => {
    if (!open || actionKey === null) return;
    setRememberPreference(false);
    setSelectedWakeAt(verb === 'Later' ? wakeAt : null);
  }, [open, verb, wakeAt, actionKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !confirmDisabled) {
        e.preventDefault();
        onConfirm({
          archiveHistoric: effectiveArchiveHistoric,
          ...(verb === 'Unsubscribe' ? { backlogMode: effectiveMode } : {}),
          ...((verb === 'Delete' || (verb === 'Unsubscribe' && effectiveMode === 'delete')) &&
          reach === 'all_mail'
            ? { reach }
            : {}),
          rememberPreference,
          wakeAt: verb === 'Later' ? selectedWakeAt : null,
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    open,
    verb,
    effectiveArchiveHistoric,
    effectiveMode,
    rememberPreference,
    selectedWakeAt,
    onConfirm,
    confirmDisabled,
    reach,
  ]);

  if (!open || !row) return null;

  const facts = buildPreviewFacts({
    verb,
    row,
    archiveHistoric: effectiveArchiveHistoric,
    ...(verb === 'Unsubscribe' ? { backlogMode: effectiveMode } : {}),
    inboxCount:
      verb === 'Unsubscribe' && effectiveMode !== 'delete' && typeof inboxCount === 'number'
        ? (inboxOptionCount ?? inboxCount)
        : inboxCount,
    wakeAt: selectedWakeAt,
    reach: verb === 'Unsubscribe' && effectiveMode !== 'delete' ? 'inbox_only' : reach,
  });
  const isCleanupAction = verb === 'Archive' || verb === 'Delete';
  const cleanupEffect = isCleanupAction
    ? buildActionPresentation({
        verb: verb === 'Archive' ? 'archive' : 'delete',
        liveCount: countKnown,
        planUndoDeadline: null,
        unsubscribeChannel: null,
        wakeAt: null,
        reach,
      }).primary
    : null;
  const confirm = () =>
    onConfirm({
      archiveHistoric: effectiveArchiveHistoric,
      ...(verb === 'Unsubscribe' ? { backlogMode: effectiveMode } : {}),
      ...((verb === 'Delete' || (verb === 'Unsubscribe' && effectiveMode === 'delete')) &&
      reach === 'all_mail'
        ? { reach }
        : {}),
      rememberPreference,
      wakeAt: verb === 'Later' ? selectedWakeAt : null,
    });

  // The checkbox hides itself when the inbox and all-mail counts match.
  const movesMail = actionMovesMail(verb, effectiveMode !== 'unsub_only');
  const reachControl =
    detail !== undefined &&
    movesMail &&
    (verb === 'Delete' || (verb === 'Unsubscribe' && effectiveMode === 'delete'))
      ? detail.reachControl
      : undefined;
  const showReach = reachControl !== undefined;
  // Empty inbox, archived mail exists: the default stays the safe one
  // (founder decision 2026-09-19) and the subtitle names the way out.
  const reachHint =
    showReach &&
    reachControl.reach === 'inbox_only' &&
    reachControl.inboxCount === 0 &&
    (reachControl.allMailCount ?? 0) > 0
      ? DELETE_ARCHIVED_HINT
      : null;

  const emailMeter = cleanupSummary.data?.metered === true;
  const costLine =
    emailMeter || facts.unitsNeeded === 0
      ? null
      : cleanupCostLine(facts.unitsNeeded, quotaRemaining);
  const detailBlock = (
    <ActionPreviewDetailBlock
      detail={detail !== undefined && movesMail ? detail : undefined}
      leadFacts={facts.disclosures}
      trailingFacts={[
        { label: PREVIEW_DETAILS.whySuggested.label, value: <PreviewReasoning row={row} /> },
        ...(verb === 'Delete'
          ? []
          : [
              {
                label: 'Don’t ask again',
                value: 'Shows this preview in the row. Change in Settings',
              },
            ]),
      ]}
    />
  );

  // Why confirm is unavailable — and the way out, where one exists. A zero
  // count needs no line: the title already says nothing is there.
  const status: ReactNode = previewSenderGone ? (
    <StatusWithAction
      message={WS2_COPY.simplify.senders.gone}
      action={onRefreshTriage ? { label: 'Refresh triage', onClick: onRefreshTriage } : undefined}
    />
  ) : nothingToActOn ? null : wakeAtInvalid ? (
    'Pick a future return time.'
  ) : previewUnavailable ? (
    <StatusWithAction
      message={WS2_COPY.preview.loadFailed}
      action={
        onRetryPreview ? { label: WS2_COPY.home.failed.retry, onClick: onRetryPreview } : undefined
      }
    />
  ) : archivedUncounted ? (
    WS5_COPY['f1.preview.archived.unavailable']
  ) : verb === 'Unsubscribe' && requiresLivePreview && inboxCount === 0 ? (
    WS5_COPY['f1.preview.backlog.none']
  ) : confirmDisabled ? (
    WS5_COPY['f1.preview.backlog.loading']
  ) : null;

  const hasControls = showReach || verb === 'Later' || verb === 'Unsubscribe' || isProtectedRow;

  return (
    <div
      role="region"
      aria-label={`Preview · ${verb} ${row.senderName}`}
      data-dm-preview-mode="modal"
    >
      <PreviewSheet
        layout={isCleanupAction ? 'review' : 'compact'}
        context={
          mailboxEmail ? <MailboxActionContextView mailboxEmail={mailboxEmail} /> : undefined
        }
        onClose={onCancel}
        testId="triage-action-sheet"
        icon={
          <span style={{ display: 'inline-flex', borderRadius: radius.lg, boxShadow: shadow.card }}>
            <Avatar
              name={row.senderName}
              domain={row.senderDomain}
              size={64}
              hasMark={row.brandMark}
            />
          </span>
        }
        title={
          verb === 'Unsubscribe'
            ? unsubscribeTitle(
                countKnown === null ? 'unsub_only' : effectiveMode,
                row.senderName,
                countKnown ?? 0,
              )
            : isCleanupAction && !facts.nothingToMove
              ? `${verb} emails from ${row.senderName}?`
              : facts.title
        }
        subtitle={
          verb === 'Archive' && !facts.nothingToMove
            ? undefined
            : cleanupEffect && !facts.nothingToMove
              ? cleanupEffect.futureMail.summary
              : (reachHint ?? facts.subtitle ?? undefined)
        }
        note={
          isCleanupAction
            ? undefined
            : verb === 'Unsubscribe'
              ? effectiveMode === 'delete'
                ? WS5_COPY['f1.honesty.delete']
                : effectiveMode === 'archive'
                  ? WS5_COPY['f1.honesty.archive']
                  : WS5_COPY['f1.honesty.unsubOnly']
              : (facts.note ?? undefined)
        }
        summary={
          cleanupEffect ? (
            <CleanupImpact
              action={verb === 'Archive' ? 'Archive' : 'Delete'}
              count={archivedUncounted || previewSenderGone ? null : countKnown}
              includesArchived={verb === 'Delete' && reach === 'all_mail'}
              olderThanDays={null}
              note={
                facts.nothingToMove
                  ? ''
                  : verb === 'Archive'
                    ? (facts.note ?? '')
                    : cleanupEffect.activityUndo.summary
              }
            />
          ) : undefined
        }
        primary={{
          label:
            verb === 'Unsubscribe'
              ? unsubscribeButton(effectiveMode, countKnown, isProtectedRow)
              : isProtectedRow
                ? `${verb} anyway`
                : isCleanupAction
                  ? verb
                  : facts.primaryLabel,
          onClick: confirm,
          tone:
            verb === 'Delete' || (verb === 'Unsubscribe' && effectiveMode === 'delete')
              ? 'danger'
              : verb === 'Unsubscribe'
                ? 'warn'
                : 'primary',
          disabled: confirmDisabled,
        }}
        status={status ?? undefined}
        details={detailBlock}
        footer={
          costLine === null && verb === 'Delete' ? undefined : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              {verb === 'Unsubscribe' ? (
                <span>
                  {WS5_COPY['f1.footer']}
                  {effectiveMode === 'delete' ? ` ${WS5_COPY['f1.deleteNote']}` : ''}
                </span>
              ) : null}
              {costLine !== null && <span>{costLine}</span>}
              {emailMeter &&
              cleanupSummary.data &&
              verb !== 'Unsubscribe' &&
              typeof inboxCount === 'number' &&
              inboxCount > 0 ? (
                <MeterPreviewLine requested={inboxCount} summary={cleanupSummary.data} />
              ) : null}
              {/*
               * D34 — remember-preference. Persists per verb in the triage
               * store. The sheet still renders for THIS action — the
               * preference applies to the NEXT one. Never offered for
               * Delete.
               */}
              {verb !== 'Delete' && (
                <CheckRow
                  checked={rememberPreference}
                  onToggle={() => setRememberPreference((v) => !v)}
                  label={`Don’t ask again for ${verb}`}
                  quiet
                />
              )}
            </div>
          )
        }
      >
        {hasControls ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
            {verb === 'Later' && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: space[3],
                  minHeight: 48,
                  padding: `0 ${space[2]}px 0 ${space[4]}px`,
                  borderRadius: radius.lg,
                  background: color.fill,
                  fontSize: text.md,
                  fontWeight: 500,
                  textAlign: 'left',
                }}
              >
                <span>Returns</span>
                <input
                  type="datetime-local"
                  aria-label="Later return time"
                  value={selectedWakeAt === null ? '' : toLocalDateTimeInput(selectedWakeAt)}
                  min={toLocalDateTimeInput(new Date(Date.now() + 60_000).toISOString())}
                  onChange={(event) => {
                    const next = new Date(event.currentTarget.value);
                    setSelectedWakeAt(Number.isNaN(next.getTime()) ? null : next.toISOString());
                  }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: color.fg,
                    fontFamily: font.sans,
                    fontSize: text.md,
                    fontVariantNumeric: 'tabular-nums',
                    minHeight: 40,
                    minWidth: 0,
                  }}
                />
              </label>
            )}

            {/* Unsubscribe only: Archive/Later already move every inbox
                message from the sender, so the backlog toggle exists only
                where the primary verb does NOT touch past mail. */}
            {verb === 'Unsubscribe' && (
              <div>
                <SheetSegmented
                  label={WS5_COPY['f1.preview.existing.label']}
                  value={effectiveMode}
                  onChange={(mode) => {
                    setBacklogMode(mode);
                    setChosenActionKey(actionKey);
                    (onReachChange ?? detail?.reachControl?.onChange)?.('inbox_only');
                  }}
                  options={[
                    { value: 'unsub_only', label: WS5_COPY['f1.segment.unsubOnly'] },
                    {
                      value: 'archive',
                      disabled: inboxOptionCount === null || inboxOptionCount === 0,
                      label:
                        inboxOptionCount === null
                          ? WS5_COPY['f1.segment.archive.loading']
                          : isPluralCopy(WS5_COPY['f1.segment.archive'])
                            ? pluralCopy(WS5_COPY['f1.segment.archive'], inboxOptionCount, {
                                n: inboxOptionCount.toLocaleString('en-US'),
                              })
                            : '',
                    },
                    {
                      value: 'delete',
                      disabled:
                        countKnown === null ||
                        (countKnown === 0 && !(detail?.reachControl?.allMailCount ?? 0)),
                      label:
                        countKnown === null
                          ? WS5_COPY['f1.segment.delete.loading']
                          : isPluralCopy(WS5_COPY['f1.segment.delete'])
                            ? pluralCopy(WS5_COPY['f1.segment.delete'], countKnown, {
                                n: countKnown.toLocaleString('en-US'),
                              })
                            : '',
                    },
                  ]}
                />
                {emailMeter && effectiveMode !== 'unsub_only' ? (
                  <p>{WS5_COPY['f1.meterFree']}</p>
                ) : null}
                {emailMeter &&
                effectiveMode !== 'unsub_only' &&
                cleanupSummary.data &&
                countKnown !== null ? (
                  <MeterPreviewLine requested={countKnown} summary={cleanupSummary.data} />
                ) : null}
              </div>
            )}

            {showReach && (
              <ActionReachControl
                value={reachControl.reach}
                inboxCount={reachControl.inboxCount}
                allMailCount={reachControl.allMailCount}
                onChange={reachControl.onChange}
              />
            )}

            {isProtectedRow && (
              <div style={{ textAlign: 'left' }}>
                {/* Closing on success is load-bearing, not tidiness: the
                    Unprotect invalidates the triage queue, the refetch drops
                    this sender from the D245 review, and `pendingRow`
                    resolves to null — which would unmount the modal
                    mid-flow while the pending action survived in the store.
                    Cancelling deliberately leaves the user somewhere they
                    chose. */}
                <ProtectedActionNotice row={row} verb={verb} unprotectSlot={unprotectSlot} />
              </div>
            )}
          </div>
        ) : undefined}
      </PreviewSheet>
    </div>
  );
}

/** A disabled-state line with its one way out ("Try again"). */
function StatusWithAction({
  message,
  action,
}: {
  message: string;
  action?: { label: string; onClick: () => void } | undefined;
}) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <span>{message}</span>
      {action && (
        <Button tone="default" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </span>
  );
}

function toLocalDateTimeInput(iso: string): string {
  const date = new Date(iso);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

/**
 * One checkbox row. `quiet` is the footer preference (plain text, no
 * well); the default is a control in the sheet body, which sits in a
 * neutral well like the segmented control beside it. Checked reads the
 * same on both — the teal glyph — so one sheet has one checked language
 * (a checked toggle that stayed visually mute read as unselected,
 * 2026-08-12).
 */
function CheckRow({
  checked,
  onToggle,
  label,
  hint,
  quiet = false,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  hint?: string;
  quiet?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      type="button"
      role="checkbox"
      aria-checked={checked}
      // Must equal the visible label (WCAG 2.5.3 label-in-name) so voice
      // control can target the visible text.
      aria-label={label}
      data-dm-checked={checked ? 'true' : 'false'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: quiet ? 'center' : 'flex-start',
        gap: 10,
        width: quiet ? 'auto' : '100%',
        minHeight: quiet ? 36 : 48,
        padding: quiet ? `0 ${space[2]}px` : `${space[2]}px ${space[4]}px`,
        background: quiet ? 'transparent' : color.fill,
        border: 'none',
        borderRadius: radius.lg,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: font.sans,
        color: quiet ? color.fgMuted : color.fg,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          borderRadius: 6,
          boxShadow: checked ? 'none' : `inset 0 0 0 1.5px ${color.fgMuted}`,
          background: checked ? color.primary : 'transparent',
          color: color.fgInverse,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {checked && (
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: quiet ? text.sm : text.md, fontWeight: quiet ? 500 : 550 }}>
          {label}
        </span>
        {hint !== undefined && (
          <span style={{ fontSize: text.xs, color: color.fgMuted }}>{hint}</span>
        )}
      </span>
    </button>
  );
}
