'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button, Eyebrow, Kbd, tokens, useFocusTrap } from '@declutrmail/shared';
import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements/undo-window';
import { ContextualHelp } from '@/features/help/contextual-help';
import { ActionPreview, type PreviewCount } from './action-preview';
import {
  ActionPreviewDetailBlock,
  actionMovesMail,
  type ActionPreviewDetail,
} from './action-preview-detail';
import type { TriageDecisionRow } from './data';
import { ProtectedActionNotice } from './protected-notice';
import type { SheetableVerb } from './store';

const { color, font } = tokens;

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
 * D226: the preview INSIDE this sheet is the mandatory preview. The
 * sheet itself is what D34 allows skipping; the preview never is.
 * `<ActionPreview mode="modal">` renders below the title.
 *
 * Keyboard: Escape cancels; Cmd/Ctrl-Enter confirms — same shortcuts
 * as `confirm-action-modal.tsx` in the senders feature so muscle
 * memory carries between screens.
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
  detail,
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
  /** Verification detail for the D226 preview (parity with senders). */
  detail?: ActionPreviewDetail | undefined;
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
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !confirmDisabled) {
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
    onCancel,
    onConfirm,
    confirmDisabled,
  ]);

  const trapRef = useFocusTrap<HTMLDivElement>(open);

  if (!open || !row) return null;

  const danger = verb === 'Delete';
  // Unsubscribe only: Archive/Later already move every inbox message
  // from the sender, so the backlog toggle exists only where the
  // primary verb does NOT touch past mail.
  const showHistoricToggle = verb === 'Unsubscribe';

  return (
    <>
      <div
        onClick={onCancel}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 150,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-triage-sheet-title"
        style={{
          position: 'fixed',
          top: '12vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(540px, calc(100vw - 32px))',
          maxHeight: '76vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: 14,
          border: `1px solid ${color.border}`,
          boxShadow: '0 24px 60px rgba(14,20,19,0.30)',
          zIndex: 151,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '20px 24px 8px', borderBottom: `1px solid ${color.line}` }}>
          <Eyebrow tone={verb === 'Unsubscribe' || danger ? 'amber' : 'primary'}>
            Preview · {verb}
          </Eyebrow>
          <h2
            id="dm-triage-sheet-title"
            style={{
              fontSize: 19,
              fontWeight: 600,
              letterSpacing: '-0.014em',
              margin: '6px 0 12px',
            }}
          >
            {row.senderName}
          </h2>
        </div>

        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Mandatory preview (D226). Same component renders inline
              when the sheet is skipped via the remember-preference. */}
          <ActionPreview
            verb={verb}
            row={row}
            archiveHistoric={effectiveArchiveHistoric}
            inboxCount={inboxCount}
            wakeAt={selectedWakeAt}
            mode="modal"
            mailboxEmail={mailboxEmail}
            quotaRemaining={quotaRemaining}
            detailSlot={
              detail !== undefined && actionMovesMail(verb, effectiveArchiveHistoric) ? (
                <ActionPreviewDetailBlock detail={detail} />
              ) : undefined
            }
          />

          <ContextualHelp question="Why do I review this before confirming?">
            The preview uses the current mailbox count and separates what will change from what will
            stay unchanged. DeclutrMail sends the action only after this preview loads and you
            confirm; Cancel changes nothing.
          </ContextualHelp>

          {verb === 'Later' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
              <span style={{ color: color.fg, fontWeight: 600 }}>Return to Inbox</span>
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
                  border: `1px solid ${color.line}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  background: color.card,
                  color: color.fg,
                  fontFamily: font.sans,
                  fontSize: 13,
                }}
              />
            </label>
          )}

          {showHistoricToggle && (
            <button
              onClick={() => setArchiveHistoric(!effectiveArchiveHistoric)}
              type="button"
              role="checkbox"
              aria-checked={effectiveArchiveHistoric}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                background: effectiveArchiveHistoric ? color.primarySoft : 'transparent',
                border: `1px solid ${effectiveArchiveHistoric ? color.primaryBorder : color.line}`,
                borderRadius: 9,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: font.sans,
              }}
            >
              <CheckSquare on={effectiveArchiveHistoric} />
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  fontSize: 12.5,
                  color: color.fg,
                }}
              >
                <span>
                  {/* The live count (never a lifetime estimate — D226). */}
                  Also archive the
                  {typeof inboxCount === 'number'
                    ? ` ${inboxCount.toLocaleString('en-US')} email${inboxCount === 1 ? '' : 's'}`
                    : ' emails'}{' '}
                  already in the inbox
                </span>
                <span style={{ fontSize: 11.5, color: color.fgMuted }}>
                  Uses a second cleanup action on Free.
                </span>
              </span>
            </button>
          )}

          {/*
           * D34 — remember-preference toggle. Persists per verb (Settings
           * page eventually owns the persisted value; for this PR it
           * lives in the Zustand store). The sheet still renders for
           * THIS action — the preference applies to the NEXT one.
           */}
          {verb !== 'Delete' && (
            <button
              onClick={() => setRememberPreference((v) => !v)}
              type="button"
              role="checkbox"
              aria-checked={rememberPreference}
              // Must equal the visible label (WCAG 2.5.3 label-in-name)
              // so voice control can target the visible text.
              aria-label="Show this in the row next time"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                // Checked state mirrors the backlog toggle above — one
                // sheet, one checked language. A checked toggle that
                // stayed visually mute read as unselected (2026-08-12).
                background: rememberPreference ? color.primarySoft : 'transparent',
                border: `1px solid ${rememberPreference ? color.primaryBorder : color.lineSoft}`,
                borderRadius: 9,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: font.sans,
              }}
            >
              <CheckSquare on={rememberPreference} muted={!rememberPreference} />
              <span style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.45 }}>
                <strong style={{ color: color.fg, fontWeight: 600 }}>
                  Show this in the row next time
                </strong>{' '}
                — the same preview will appear below the sender. You can change this in Settings.
              </span>
            </button>
          )}
        </div>

        {isProtectedRow && (
          <div style={{ margin: '0 24px 12px' }}>
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

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 24px 18px',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <span style={{ fontSize: 11.5, color: color.fgMuted }}>
            {/* Honest reversibility (D58): a delivered network
                unsubscribe can't be recalled — no undo token exists for
                it by design. Only the archived backlog is undoable.
                Archive/Later are fully reversible (D232). */}
            {confirmDisabled
              ? nothingToActOn
                ? 'No matching email in Inbox right now — nothing to act on.'
                : wakeAtInvalid
                  ? 'Later needs a future return time before you can confirm.'
                  : inboxCount === 'unavailable'
                    ? "Couldn't load a live preview. Close and retry — no inbox email can move without one."
                    : 'Counting inbox email — confirm unlocks after the live preview loads.'
              : verb === 'Unsubscribe'
                ? effectiveArchiveHistoric
                  ? UNIFORM_UNDO_WINDOW_DAYS === null
                    ? "The unsubscribe itself can't be undone — the archived email uses your plan's Activity undo window."
                    : `The unsubscribe itself can't be undone — the archived email uses the ${UNIFORM_UNDO_WINDOW_DAYS}-day Activity undo window.`
                  : "The unsubscribe request can't be undone. Existing inbox email stays put."
                : verb === 'Delete'
                  ? UNIFORM_UNDO_WINDOW_DAYS === null
                    ? "Moves matching inbox email to Gmail Trash. Activity Undo uses your plan's window; Gmail normally keeps Trash for up to 30 days."
                    : `Moves matching inbox email to Gmail Trash. Activity Undo uses the ${UNIFORM_UNDO_WINDOW_DAYS}-day window; Gmail normally keeps Trash for up to 30 days.`
                  : UNIFORM_UNDO_WINDOW_DAYS === null
                    ? "Reversible for your plan's undo window from Activity."
                    : `Reversible for the ${UNIFORM_UNDO_WINDOW_DAYS}-day undo window from Activity.`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {previewUnavailable && onRetryPreview && (
              <Button tone="default" onClick={onRetryPreview}>
                Retry preview
              </Button>
            )}
            <Button tone="default" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              tone={danger ? 'danger' : verb === 'Unsubscribe' ? 'warn' : 'primary'}
              disabled={confirmDisabled}
              onClick={() =>
                onConfirm({
                  archiveHistoric: effectiveArchiveHistoric,
                  rememberPreference,
                  wakeAt: verb === 'Later' ? selectedWakeAt : null,
                })
              }
              iconRight={
                <Kbd
                  style={{
                    background: color.lineInverse,
                    border: 'none',
                    color: color.fgInverse,
                  }}
                >
                  ⌘⏎
                </Kbd>
              }
            >
              {isProtectedRow ? `${verb} anyway` : verb}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function toLocalDateTimeInput(iso: string): string {
  const date = new Date(iso);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Inline checkbox glyph — matches `confirm-action-modal.tsx` shape. */
function CheckSquare({ on, muted = false }: { on: boolean; muted?: boolean }) {
  const ringColor = muted ? color.fgMuted : color.primary;
  const ringOff = muted ? 'rgba(14,20,19,0.18)' : 'rgba(14,20,19,0.28)';
  return (
    <span
      aria-hidden="true"
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        border: `1.5px solid ${on ? ringColor : ringOff}`,
        background: on ? ringColor : color.card,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {on && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </span>
  );
}
