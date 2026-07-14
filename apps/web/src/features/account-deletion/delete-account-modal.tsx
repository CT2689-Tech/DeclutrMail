'use client';

import { useEffect, useState } from 'react';
import { Button, Eyebrow, tokens, useFocusTrap } from '@declutrmail/shared';
import {
  DELETION_CONFIRM_PHRASE,
  DELETION_WAIVER_PHRASE,
  type AccountDeletionProjection,
} from '@declutrmail/shared/contracts';

const { color, font } = tokens;

/**
 * D216 account-deletion modal — 2-step confirm:
 *
 *   Step 1 — what gets deleted / what doesn't + checkbox acknowledgment.
 *   Step 2 — the D232 schedule (computed effective date + undo-window
 *            note), the immediate-waiver option, and the typed
 *            confirmation input.
 *
 * Typed phrases (validated server-side; the input here is UX):
 *   - `DELETE`                → scheduled at max(now+7d, latest undo expiry)
 *   - `DELETE AND WAIVE UNDO` → immediate; waives open undo windows
 *
 * The waiver copy is honest per D232: immediate deletion conflicts with
 * open undo windows, so choosing it explicitly forfeits them — the UI
 * says so rather than hiding it.
 *
 * Keyboard: Escape cancels. No Enter-to-confirm shortcut — destructive
 * typed-confirm flows must not be completable by a stray keypress
 * (D207 trust posture).
 */
export function DeleteAccountModal({
  open,
  projection,
  onCancel,
  onConfirm,
  isSubmitting,
  submitError,
}: {
  open: boolean;
  /** Fresh D232 projection from GET /api/account/deletion. */
  projection: AccountDeletionProjection | null;
  onCancel: () => void;
  /** Fires with the EXACT phrase the user typed (server re-validates). */
  onConfirm: (confirmPhrase: string) => void;
  isSubmitting: boolean;
  submitError: string | null;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [acknowledged, setAcknowledged] = useState(false);
  const [mode, setMode] = useState<'scheduled' | 'immediate'>('scheduled');
  const [typed, setTyped] = useState('');

  // Reset on every open so an abandoned attempt never leaves a
  // half-acknowledged state behind.
  useEffect(() => {
    if (open) {
      setStep(1);
      setAcknowledged(false);
      setMode('scheduled');
      setTyped('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, isSubmitting]);

  const trapRef = useFocusTrap<HTMLDivElement>(open);

  if (!open) return null;

  const requiredPhrase = mode === 'immediate' ? DELETION_WAIVER_PHRASE : DELETION_CONFIRM_PHRASE;
  const phraseMatches = typed === requiredPhrase;
  const hasUndo = (projection?.activeUndoCount ?? 0) > 0;
  const undoExtends = projection?.projectedBasis === 'undo-window';

  return (
    <>
      <div
        onClick={isSubmitting ? undefined : onCancel}
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
        aria-labelledby="dm-delete-account-title"
        style={{
          position: 'fixed',
          top: '12vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(520px, calc(100vw - 32px))',
          maxHeight: '78vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: 14,
          border: `1px solid ${color.border}`,
          boxShadow: '0 24px 60px rgba(14,20,19,0.30)',
          zIndex: 151,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${color.line}` }}>
          <Eyebrow>Account · step {step} of 2</Eyebrow>
          <h2
            id="dm-delete-account-title"
            style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.014em', margin: '6px 0 0' }}
          >
            Delete account and data
          </h2>
        </div>

        {step === 1 ? (
          <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={listHeadStyle}>What gets permanently deleted</div>
              <ul style={listStyle}>
                <li>Gmail metadata index (senders, subjects, snippets, labels, dates)</li>
                <li>Sender decisions and Screener history</li>
                <li>Automation rules</li>
                <li>Undo history</li>
                <li>Your DeclutrMail account and workspace</li>
              </ul>
            </div>
            <div>
              <div style={listHeadStyle}>What is NOT touched</div>
              <ul style={listStyle}>
                <li>Deleting your DeclutrMail account does not delete emails in Gmail</li>
              </ul>
            </div>
            <div>
              <div style={listHeadStyle}>What is retained under policy</div>
              <ul style={listStyle}>
                <li>
                  Narrowly scoped pseudonymous security and deletion evidence, without message
                  bodies or attachments
                </li>
              </ul>
            </div>
            <label
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                fontSize: 13,
                color: color.fgSoft,
                cursor: 'pointer',
                lineHeight: 1.45,
              }}
            >
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              I understand this permanently deletes my DeclutrMail account and mailbox product data,
              does not delete Gmail mail, and retains the minimal pseudonymous security and deletion
              evidence described above under its operational policy.
            </label>
          </div>
        ) : (
          <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {hasUndo && (
              <p style={{ fontSize: 13, color: color.fgSoft, margin: 0, lineHeight: 1.5 }}>
                Deleting your DeclutrMail account permanently removes the data required to undo
                recent DeclutrMail actions. You have{' '}
                <strong>
                  {projection!.activeUndoCount} undoable action
                  {projection!.activeUndoCount === 1 ? '' : 's'}
                </strong>
                {projection!.latestUndoExpiresAt && (
                  <>
                    , the latest expiring in{' '}
                    <strong>{daysUntil(projection!.latestUndoExpiresAt)}</strong>
                  </>
                )}
                .
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ModeOption
                checked={mode === 'scheduled'}
                onSelect={() => {
                  setMode('scheduled');
                  setTyped('');
                }}
                title={
                  projection
                    ? `Schedule deletion for ${formatDate(projection.projectedEffectiveAt)}`
                    : 'Schedule deletion'
                }
                detail={
                  undoExtends
                    ? 'Your deletion is delayed past the 7-day grace period because an undo ' +
                      `window stays open until ${formatDate(projection!.latestUndoExpiresAt!)}. ` +
                      'Undo keeps working for its full window; you can cancel any time before then.'
                    : '7-day grace period. You can cancel any time before then.'
                }
              />
              <ModeOption
                checked={mode === 'immediate'}
                onSelect={() => {
                  setMode('immediate');
                  setTyped('');
                }}
                title="Delete immediately"
                detail={
                  hasUndo
                    ? 'No grace period — deletion runs within minutes, and your open undo ' +
                      'windows are waived: actions you could still undo become permanent.'
                    : 'No grace period — deletion runs within minutes.'
                }
                danger
              />
            </div>

            <div>
              <label
                htmlFor="dm-delete-typed-confirm"
                style={{ fontSize: 12, color: color.fgMuted, display: 'block', marginBottom: 6 }}
              >
                Type <strong style={{ fontFamily: font.mono }}>{requiredPhrase}</strong> to confirm
              </label>
              <input
                id="dm-delete-typed-confirm"
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={requiredPhrase}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  fontFamily: font.mono,
                  fontSize: 13,
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: `1px solid ${phraseMatches ? color.emerald : color.border}`,
                  background: color.paper,
                  color: color.fg,
                  outline: 'none',
                }}
              />
            </div>

            {submitError != null && (
              <div
                role="alert"
                style={{
                  fontSize: 12,
                  color: color.danger,
                  background: color.dangerBg,
                  border: `1px solid ${color.dangerBorder}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                }}
              >
                {submitError}
              </div>
            )}
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
            {step === 1
              ? 'Nothing is deleted yet.'
              : 'A confirmation email with a cancel link follows.'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button tone="default" onClick={onCancel} disabled={isSubmitting}>
              Keep my account
            </Button>
            {step === 1 ? (
              <Button tone="primary" onClick={() => setStep(2)} disabled={!acknowledged}>
                Review deletion timing
              </Button>
            ) : (
              <Button
                tone="danger"
                onClick={() => onConfirm(typed)}
                disabled={!phraseMatches || isSubmitting}
              >
                {isSubmitting
                  ? 'Submitting…'
                  : mode === 'immediate'
                    ? 'Delete immediately'
                    : 'Schedule deletion'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ModeOption({
  checked,
  onSelect,
  title,
  detail,
  danger,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
  danger?: boolean;
}) {
  return (
    <label
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${checked ? (danger ? color.dangerBorder : color.primaryBorder) : color.line}`,
        background: checked ? color.paper : 'transparent',
        cursor: 'pointer',
      }}
    >
      <input
        type="radio"
        name="dm-delete-mode"
        checked={checked}
        onChange={onSelect}
        style={{ marginTop: 2 }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: danger ? color.danger : color.fg,
          }}
        >
          {title}
        </span>
        <span style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.45 }}>{detail}</span>
      </span>
    </label>
  );
}

const listHeadStyle = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase' as const,
  color: color.fgMuted,
  marginBottom: 6,
};

const listStyle = {
  margin: 0,
  paddingLeft: 18,
  fontSize: 13,
  color: color.fgSoft,
  lineHeight: 1.6,
};

/** "June 18, 2026" in the user's locale. */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(iso));
}

/** "12 days" / "1 day" / "less than a day" until an ISO instant. */
export function daysUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return 'less than a day';
  return `${days} day${days === 1 ? '' : 's'}`;
}
