'use client';

import { Button, OVERLAY_Z } from '@declutrmail/shared';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';

import { fillDeck, formatCount } from './home-deck-copy';
import type { HomeFixCandidate } from './home-next-steps';
import { homeFixCopy, type HomeFixCopy } from './home-ws5-copy';
import styles from './home-view.module.css';

function archivedEmails(count: number, copy: HomeFixCopy): string | null {
  const template = count === 1 ? copy.emailsOne : copy.emailsOther;
  return fillDeck(template, { n: formatCount(count) });
}

function dialogTitle(step: HomeFixCandidate, copy: HomeFixCopy): string | null {
  const emails = step.emailCount;
  if (emails === undefined || emails <= 0) return null;
  if (step.senderCount === 1 && step.senderName) {
    const template = emails === 1 ? copy.titleOne : copy.titleOther;
    return fillDeck(template, { Sender: step.senderName, n: formatCount(emails) });
  }
  const emailCount = archivedEmails(emails, copy);
  if (emailCount === null) return null;
  const template = step.senderCount === 1 ? copy.titleBulkOne : copy.titleBulkOther;
  return fillDeck(template, {
    k: formatCount(step.senderCount),
    emailCount,
  });
}

/**
 * Prefills Unsubscribe + Archive and does not confirm on open or Enter.
 * Cancel takes initial focus. Focus stays in the dialog and returns to
 * the control that opened it.
 */
export function HomeFixDialog({
  step,
  onCancel,
  onConfirm,
}: {
  step: HomeFixCandidate;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = homeFixCopy();
  const title = copy === null ? null : dialogTitle(step, copy);
  const trapRef = useFocusTrap<HTMLDivElement>(title !== null, {
    initialFocusSelector: '#home-fix-cancel',
  });
  if (copy === null || title === null) return null;
  return (
    <div
      className={styles.dialogScrim}
      role="presentation"
      style={{ zIndex: OVERLAY_Z.modal }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={trapRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="home-fix-title"
        aria-describedby="home-fix-honesty"
        className={styles.dialog}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
          }
          if (event.key === 'Escape') onCancel();
        }}
      >
        <h2 id="home-fix-title">{title}</h2>
        <p id="home-fix-honesty">{copy.honesty}</p>
        <div className={styles.dialogActions}>
          <Button tone="warn" size="lg" onClick={onConfirm}>
            {copy.button}
          </Button>
          <Button id="home-fix-cancel" tone="ghost" size="lg" onClick={onCancel}>
            {copy.cancel}
          </Button>
        </div>
      </div>
    </div>
  );
}
