'use client';

import { useEffect, type ReactNode } from 'react';
import { PreviewSheet, SheetFact, tokens, type ButtonTone } from '@declutrmail/shared';

const { color } = tokens;

/**
 * The Autopilot D226 preview modals (turn on / approve / pause) on the
 * shared `PreviewSheet` (ADR-0042). This wrapper adds only what the three
 * share and the sheet does not own:
 *
 *   - ⌘/Ctrl+Enter commits the primary action, under the same guard as
 *     the visible button (never while busy, never before `canConfirm`);
 *   - the Gmail account moves into Details as a plain fact;
 *   - a failed commit renders in the sheet's live status line.
 *
 * What the mutation will do (verb copy, counts, affected senders) is the
 * caller's `subtitle` / `children` / `note` / `details`.
 */
export function ConfirmModalFrame({
  title,
  subtitle,
  children,
  note,
  details,
  confirmLabel,
  confirmBusyLabel,
  confirmTone,
  canConfirm,
  mailboxEmail,
  isBusy,
  error,
  onCancel,
  onConfirm,
  testId,
}: {
  title: string;
  /** One sentence: what the commit does. */
  subtitle: ReactNode;
  /** The fact or choice the user acts on. */
  children?: ReactNode;
  /** One line: how to stop or undo it. */
  note?: ReactNode;
  /** Everything else — collapsed. The Gmail account is appended here. */
  details?: ReactNode;
  confirmLabel: string;
  confirmBusyLabel: string;
  confirmTone?: ButtonTone;
  /** Mirrors the visible confirm button's enablement on the keyboard path. */
  canConfirm: boolean;
  /** The active mailbox, shown in Details; omitted renders nothing. */
  mailboxEmail?: string | undefined;
  isBusy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  testId?: string;
}) {
  const confirmEnabled = canConfirm && !isBusy;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && confirmEnabled) {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onConfirm, confirmEnabled]);

  const hasDetails = details != null || Boolean(mailboxEmail);

  return (
    <PreviewSheet
      onClose={onCancel}
      title={title}
      subtitle={subtitle}
      note={note}
      details={
        hasDetails ? (
          <>
            {details}
            {mailboxEmail ? <SheetFact label="Gmail account">{mailboxEmail}</SheetFact> : null}
          </>
        ) : undefined
      }
      primary={{
        label: confirmLabel,
        onClick: onConfirm,
        disabled: !canConfirm,
        busyLabel: isBusy ? confirmBusyLabel : undefined,
        ...(confirmTone == null ? {} : { tone: confirmTone }),
      }}
      status={
        error != null ? (
          <span role="alert" style={{ color: color.danger }}>
            {error}
          </span>
        ) : undefined
      }
      {...(testId == null ? {} : { testId })}
    >
      {children}
    </PreviewSheet>
  );
}
