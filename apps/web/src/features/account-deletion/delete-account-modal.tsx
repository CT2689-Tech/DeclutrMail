'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { PreviewSheet, tokens } from '@declutrmail/shared';
import {
  DELETION_CONFIRM_PHRASE,
  DELETION_WAIVER_PHRASE,
  type AccountDeletionProjection,
} from '@declutrmail/shared/contracts';

import { useUserTimeZone } from '@/features/auth/api/use-me';

const { color, font, motion, radius, text } = tokens;

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
  const timeZone = useUserTimeZone();

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

  if (!open) return null;

  const requiredPhrase = mode === 'immediate' ? DELETION_WAIVER_PHRASE : DELETION_CONFIRM_PHRASE;
  const phraseMatches = typed === requiredPhrase;
  const hasUndo = (projection?.activeUndoCount ?? 0) > 0;
  const undoExtends = projection?.projectedBasis === 'undo-window';

  // The shared confirmation sheet, danger-toned for both steps: focus
  // lands on "Keep my account", never on the way forward. Escape and a
  // scrim click cancel (both held while submitting). No Enter-to-confirm
  // — a typed-confirm deletion must not be completable by a stray key.
  return (
    <PreviewSheet
      onClose={onCancel}
      icon={<DangerGlyph />}
      title="Delete your DeclutrMail account?"
      subtitle={
        step === 1 ? (
          'Deleting your DeclutrMail account does not delete emails in Gmail.'
        ) : hasUndo ? (
          <>
            Deleting your DeclutrMail account permanently removes the data required to undo recent
            DeclutrMail actions. You have{' '}
            <strong style={{ color: color.fg }}>
              {projection!.activeUndoCount} undoable action
              {projection!.activeUndoCount === 1 ? '' : 's'}
            </strong>
            {projection!.latestUndoExpiresAt && (
              <>
                , the latest expiring in{' '}
                <strong style={{ color: color.fg }}>
                  {daysUntil(projection!.latestUndoExpiresAt)}
                </strong>
              </>
            )}
            .
          </>
        ) : (
          'Choose when it runs.'
        )
      }
      note={
        step === 1 ? 'Nothing is deleted yet.' : 'A confirmation email with a cancel link follows.'
      }
      primary={
        step === 1
          ? {
              label: 'Review deletion timing',
              tone: 'danger',
              onClick: () => setStep(2),
              disabled: !acknowledged,
            }
          : {
              label: mode === 'immediate' ? 'Delete immediately' : 'Schedule deletion',
              tone: 'danger',
              onClick: () => onConfirm(typed),
              disabled: !phraseMatches,
              busyLabel: isSubmitting ? 'Submitting…' : undefined,
            }
      }
      cancelLabel="Keep my account"
      footer={`Step ${step} of 2`}
    >
      {step === 1 ? (
        <div style={bodyStyle}>
          <FactList title="What gets permanently deleted">
            <li>Saved Gmail details (senders, subjects, snippets, labels, dates)</li>
            <li>Sender decisions and Screener history</li>
            <li>Automation rules</li>
            <li>Undo history</li>
            <li>Your DeclutrMail account and workspace</li>
          </FactList>
          <FactList title="What is retained under policy">
            <li>
              Narrowly scoped pseudonymous security and deletion evidence, without message bodies or
              attachments
            </li>
          </FactList>
          <label
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              fontSize: text.sm,
              color: color.fgSoft,
              cursor: 'pointer',
              lineHeight: 1.5,
            }}
          >
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              style={{ marginTop: 2, width: 18, height: 18, accentColor: color.danger }}
            />
            I understand this permanently deletes my DeclutrMail account, does not delete my Gmail
            email, and retains the security and deletion evidence listed above.
          </label>
        </div>
      ) : (
        <div style={bodyStyle}>
          <div role="radiogroup" aria-label="When to delete" style={{ display: 'grid', gap: 6 }}>
            <ModeOption
              checked={mode === 'scheduled'}
              onSelect={() => {
                setMode('scheduled');
                setTyped('');
              }}
              title={
                projection
                  ? `Schedule deletion for ${formatDate(projection.projectedEffectiveAt, timeZone)}`
                  : 'Schedule deletion'
              }
              detail={
                undoExtends
                  ? 'Waits for your open undo windows, so it runs ' +
                    `${formatDate(projection!.latestUndoExpiresAt!, timeZone)} instead of in 7 days. ` +
                    'Undo keeps working until then, and you can cancel any time.'
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
                    'windows end: actions you could still undo become permanent.'
                  : 'No grace period — deletion runs within minutes.'
              }
              danger
            />
          </div>

          <div>
            <label
              htmlFor="dm-delete-typed-confirm"
              style={{
                fontSize: text.sm,
                color: color.fgMuted,
                display: 'block',
                marginBottom: 6,
              }}
            >
              Type <strong style={{ color: color.fg, fontWeight: 600 }}>{requiredPhrase}</strong> to
              confirm
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
                height: 44,
                fontFamily: font.sans,
                fontSize: text.md,
                fontWeight: 500,
                letterSpacing: '0.02em',
                padding: '0 14px',
                borderRadius: radius.md,
                border: 'none',
                boxShadow: phraseMatches ? `inset 0 0 0 1.5px ${color.emerald}` : 'none',
                background: color.fill,
                color: color.fg,
                outline: 'none',
              }}
            />
          </div>

          {submitError != null && (
            <div
              role="alert"
              style={{
                fontSize: text.sm,
                color: color.danger,
                background: color.dangerBg,
                borderRadius: radius.md,
                padding: '10px 12px',
              }}
            >
              {submitError}
            </div>
          )}
        </div>
      )}
    </PreviewSheet>
  );
}

function DangerGlyph() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 64,
        height: 64,
        borderRadius: radius.pill,
        background: color.dangerBg,
        color: color.danger,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M19 6l-1 14H6L5 6" />
      </svg>
    </span>
  );
}

function FactList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: text.sm, fontWeight: 600, color: color.fg, marginBottom: 4 }}>
        {title}
      </div>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          fontSize: text.sm,
          color: color.fgSoft,
          lineHeight: 1.6,
        }}
      >
        {children}
      </ul>
    </div>
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
        gap: 12,
        alignItems: 'flex-start',
        padding: '12px 14px',
        borderRadius: radius.lg,
        background: checked ? color.fill : 'transparent',
        cursor: 'pointer',
        transition: `background ${motion.fast} ${motion.ease}`,
      }}
    >
      <input
        type="radio"
        name="dm-delete-mode"
        checked={checked}
        onChange={onSelect}
        style={{ marginTop: 3, accentColor: danger ? color.danger : color.primary }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span
          style={{
            fontSize: text.md,
            fontWeight: 600,
            color: danger ? color.danger : color.fg,
          }}
        >
          {title}
        </span>
        <span style={{ fontSize: text.sm, color: color.fgSoft, lineHeight: 1.45 }}>{detail}</span>
      </span>
    </label>
  );
}

const bodyStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 16,
  textAlign: 'left' as const,
};

/**
 * "June 18, 2026". Locale + zone pinned: the grace-period banner
 * renders this into server-hydrated HTML on every app route (the
 * deletion status is prefetched by the ServerAppBoundary), so both
 * halves must be deterministic (React #418; e2e hydration-smoke). The
 * user zone decides the calendar day.
 */
export function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  }).format(new Date(iso));
}

/** "12 days" / "1 day" / "less than a day" until an ISO instant. */
export function daysUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return 'less than a day';
  return `${days} day${days === 1 ? '' : 's'}`;
}
