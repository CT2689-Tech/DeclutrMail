'use client';

import { useEffect, type ReactNode } from 'react';
import { afterLead } from '@/lib/copy/after-lead';
import {
  PreviewSheet,
  SheetFactList,
  tokens,
  type ButtonTone,
  type SheetFactItem,
} from '@declutrmail/shared';

const { color } = tokens;

/**
 * The Autopilot D226 preview modals (turn on / approve / pause) on the
 * shared `PreviewSheet` (ADR-0042). This wrapper adds only what the three
 * share and the sheet does not own:
 *
 *   - ⌘/Ctrl+Enter commits the primary action, under the same guard as
 *     the visible button (never while busy, never before `canConfirm`);
 *   - Details reads list → facts → sample: the caller's list (senders,
 *     rules) first, then its short facts with the Gmail account last,
 *     then any trailing block;
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
  facts = [],
  trailing,
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
  /** Collapsed, first: the list the commit acts on (senders, rules). */
  details?: ReactNode;
  /** Collapsed, after `details`: short label/value facts. The Gmail account is appended. */
  facts?: readonly SheetFactItem[];
  /** Collapsed, last: e.g. the sample of matching senders. */
  trailing?: ReactNode;
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

  const allFacts: readonly SheetFactItem[] = mailboxEmail
    ? [...facts, { label: 'Gmail account', value: mailboxEmail }]
    : facts;
  const hasDetails = details != null || trailing != null || allFacts.length > 0;

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
            <SheetFactList facts={allFacts} />
            {trailing}
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

/**
 * What one match gets beyond the sheet's subtitle, as facts. Archive has
 * nothing more to say (its effect IS the subtitle); Later adds when mail
 * returns; Unsubscribe adds that existing email stays put.
 */
export function ruleEffectFacts(primary: {
  verb: string;
  schedule: { kind: string; summary?: string };
}): SheetFactItem[] {
  if (primary.schedule.kind === 'scheduled' && primary.schedule.summary !== undefined) {
    return [{ label: 'Returns', value: afterLead(primary.schedule.summary, 'Returns to Inbox ') }];
  }
  if (primary.verb === 'unsubscribe') {
    return [{ label: 'Existing email', value: 'Stays where it is' }];
  }
  return [];
}
