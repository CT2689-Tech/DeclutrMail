'use client';

import { useEffect } from 'react';
import { Button } from '@declutrmail/shared';

import { fillDeck, formatCount, HOME_DECK } from './home-deck-copy';
import type { HomeFixCandidate } from './home-next-steps';
import styles from './home-view.module.css';

function dialogTitle(step: HomeFixCandidate): string | null {
  const emails = step.emailCount;
  if (emails === undefined || emails <= 0) return null;
  if (step.senderCount === 1 && step.senderName) {
    const template = emails === 1 ? HOME_DECK.f1TitleOne : HOME_DECK.f1TitleOther;
    return fillDeck(template, { Sender: step.senderName, n: formatCount(emails) });
  }
  return fillDeck(HOME_DECK.f1TitleBulk, {
    k: formatCount(step.senderCount),
    n: formatCount(emails),
  });
}

/**
 * Prefills Unsubscribe + Archive and does not confirm on open or Enter.
 * Cancel takes initial focus. The sheet sits above the mobile tab bar.
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
  const title = dialogTitle(step);
  useEffect(() => {
    document.getElementById('home-fix-cancel')?.focus();
  }, []);
  if (title === null) return null;
  return (
    <div
      className={styles.dialogScrim}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
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
        <p id="home-fix-honesty">{HOME_DECK.f1Honesty}</p>
        <div className={styles.dialogActions}>
          <Button tone="warn" size="lg" onClick={onConfirm}>
            {HOME_DECK.f1Button}
          </Button>
          <Button id="home-fix-cancel" tone="ghost" size="lg" onClick={onCancel}>
            {HOME_DECK.f1Cancel}
          </Button>
        </div>
      </div>
    </div>
  );
}
