'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Avatar,
  Button,
  PreviewSheet,
  SheetFact,
  SheetSegmented,
  tokens,
} from '@declutrmail/shared';
import type { ActionReach } from '@declutrmail/shared/contracts';
import type { PreviewCount } from './action-preview';
import {
  ActionPreviewDetailBlock,
  actionMovesMail,
  type ActionPreviewDetail,
} from './action-preview-detail';
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
  /** Exact return time confirmed for Later; null for other verbs. */
  wakeAt: string | null;
  /** Final value of the remember-preference toggle when confirming. */
  rememberPreference: boolean;
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
 * Layout is the shared `PreviewSheet` (ADR-0042): the count in the
 * title, where the email goes in the subtitle, how to undo it in the
 * note — each once — and every other fact behind "Details".
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
  // Unsubscribe defaults to leaving the backlog alone. It is a separate
  // Gmail mutation and a second cleanup unit on Free, so it must be an
  // explicit opt-in. Archive and Later ignore the toggle —
  // both verbs already act on every inbox message from the sender
  // (the worker resolves "in INBOX now"), so a separate historic
  // toggle would be a no-op lie.
  const [archiveHistoric, setArchiveHistoric] = useState(false);
  const [rememberPreference, setRememberPreference] = useState(false);
  const [selectedWakeAt, setSelectedWakeAt] = useState<string | null>(wakeAt);
  const actionKey = open && row ? `${verb}:${row.id}` : null;
  const [initializedActionKey, setInitializedActionKey] = useState<string | null>(null);
  // The first render of a newly opened Unsubscribe sheet must use its safe
  // default immediately, before the reset effect runs. Otherwise a fast
  // Cmd/Ctrl-Enter could observe the previous action's `false` toggle.
  const effectiveArchiveHistoric =
    actionKey !== null && initializedActionKey !== actionKey ? false : archiveHistoric;

  // Archive/Later/Delete always move inbox mail. Unsubscribe only does when the
  // user keeps the backlog option on. Any such action requires the live
  // count to have resolved; loading/failure must fail closed for click and
  // keyboard submission alike.
  const requiresLivePreview =
    verb === 'Archive' ||
    verb === 'Later' ||
    verb === 'Delete' ||
    (verb === 'Unsubscribe' && effectiveArchiveHistoric);
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
  // real work at a zero backlog and is charged a unit either way.
  const primaryActsOnInbox = verb === 'Archive' || verb === 'Later' || verb === 'Delete';
  const nothingToActOn = primaryActsOnInbox && inboxCount === 0;
  const confirmDisabled =
    previewSenderGone ||
    (requiresLivePreview && (previewPending || previewUnavailable)) ||
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
    if (!open || actionKey === null) {
      setInitializedActionKey(null);
      return;
    }
    setArchiveHistoric(false);
    setRememberPreference(false);
    setSelectedWakeAt(verb === 'Later' ? wakeAt : null);
    setInitializedActionKey(actionKey);
  }, [open, verb, wakeAt, actionKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !confirmDisabled) {
        e.preventDefault();
        onConfirm({
          archiveHistoric: effectiveArchiveHistoric,
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
    rememberPreference,
    selectedWakeAt,
    onConfirm,
    confirmDisabled,
  ]);

  if (!open || !row) return null;

  const facts = buildPreviewFacts({
    verb,
    row,
    archiveHistoric: effectiveArchiveHistoric,
    inboxCount,
    wakeAt: selectedWakeAt,
    reach,
  });
  const confirm = () =>
    onConfirm({
      archiveHistoric: effectiveArchiveHistoric,
      rememberPreference,
      wakeAt: verb === 'Later' ? selectedWakeAt : null,
    });

  // ADR-0028 — the reach is a control only when it changes the count.
  const reachControl =
    detail !== undefined && actionMovesMail(verb, effectiveArchiveHistoric)
      ? detail.reachControl
      : undefined;
  const showReach =
    reachControl !== undefined && reachControl.inboxCount !== reachControl.allMailCount;
  // Empty inbox, archived mail exists: the default stays the safe one
  // (founder decision 2026-09-19) and the subtitle names the way out.
  const reachHint =
    showReach &&
    reachControl.reach === 'inbox_only' &&
    reachControl.inboxCount === 0 &&
    reachControl.allMailCount > 0
      ? 'Switch to Inbox + archived to reach the archived email.'
      : null;

  const costLine = cleanupCostLine(facts.unitsNeeded, quotaRemaining);
  const detailBlock =
    detail !== undefined && actionMovesMail(verb, effectiveArchiveHistoric) ? (
      <ActionPreviewDetailBlock detail={detail} />
    ) : null;

  // Why confirm is unavailable — and the way out, where one exists. A zero
  // count needs no line: the title already says nothing is there.
  const status: ReactNode = !confirmDisabled ? null : previewSenderGone ? (
    <StatusWithAction
      message="This sender is no longer in this mailbox."
      action={onRefreshTriage ? { label: 'Refresh triage', onClick: onRefreshTriage } : undefined}
    />
  ) : nothingToActOn ? null : wakeAtInvalid ? (
    'Pick a future return time.'
  ) : previewUnavailable ? (
    <StatusWithAction
      message="Couldn’t load the preview. Nothing can move until it loads."
      action={onRetryPreview ? { label: 'Retry preview', onClick: onRetryPreview } : undefined}
    />
  ) : (
    'Counting the inbox…'
  );

  const hasControls = showReach || verb === 'Later' || verb === 'Unsubscribe' || isProtectedRow;

  return (
    <div
      role="region"
      aria-label={`Preview · ${verb} ${row.senderName}`}
      data-dm-preview-mode="modal"
    >
      <PreviewSheet
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
        title={facts.title}
        subtitle={reachHint ?? facts.subtitle ?? undefined}
        note={facts.note ?? undefined}
        primary={{
          label: isProtectedRow ? `${verb} anyway` : facts.primaryLabel,
          onClick: confirm,
          tone: verb === 'Delete' ? 'danger' : verb === 'Unsubscribe' ? 'warn' : 'primary',
          disabled: confirmDisabled,
        }}
        status={status ?? undefined}
        details={
          <>
            {mailboxEmail ? (
              <div role="note" aria-label={`Gmail account: ${mailboxEmail}`}>
                <SheetFact label="Gmail account">{mailboxEmail}</SheetFact>
              </div>
            ) : null}
            {facts.disclosures.map((line) => (
              <span key={line}>{line}</span>
            ))}
            {detailBlock}
            <PreviewReasoning row={row} />
            {verb !== 'Delete' && (
              <span>
                “Don’t ask again” shows this preview in the row instead. Change it in Settings.
              </span>
            )}
          </>
        }
        footer={
          costLine === null && verb === 'Delete' ? undefined : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              {costLine !== null && <span>{costLine}</span>}
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
            {showReach && (
              <SheetSegmented
                label="Where it applies"
                value={reachControl.reach}
                onChange={reachControl.onChange}
                options={[
                  { value: 'inbox_only', label: 'Inbox only', count: reachControl.inboxCount },
                  {
                    value: 'all_mail',
                    label: 'Inbox + archived',
                    count: reachControl.allMailCount,
                  },
                ]}
              />
            )}

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
                  fontWeight: 550,
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
              <CheckRow
                checked={effectiveArchiveHistoric}
                onToggle={() => setArchiveHistoric(!effectiveArchiveHistoric)}
                label={
                  // The live count (never a lifetime estimate — D226).
                  `Also archive the${
                    typeof inboxCount === 'number'
                      ? ` ${inboxCount.toLocaleString('en-US')} email${inboxCount === 1 ? '' : 's'}`
                      : ' emails'
                  } already in the inbox`
                }
                hint="Uses a second cleanup action on Free."
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

/** A disabled-state line with its one way out ("Retry preview"). */
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
