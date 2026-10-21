'use client';

import { Button, DialogFrame, tokens } from '@declutrmail/shared';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';

import { fillDeck, formatCount } from './home-deck-copy';
import type { HomeFixCandidate } from './home-next-steps';
import { homeFixCopy, type HomeFixCopy } from './home-ws5-copy';

function dialogTitle(step: HomeFixCandidate, copy: HomeFixCopy): string | null {
  const emails = step.emailCount;
  if (emails === undefined || emails <= 0) return null;
  if (step.senderCount === 1 && step.senderName) return copy.titleThisSender;
  const template = step.senderCount === 1 ? copy.titleBulkOne : copy.titleBulkOther;
  return fillDeck(template, { k: formatCount(step.senderCount) });
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
  const emailCount = step.emailCount;
  const trapRef = useFocusTrap<HTMLDivElement>(title !== null, {
    initialFocusSelector: '#home-fix-cancel',
  });
  if (copy === null || title === null || emailCount === undefined) return null;
  return (
    <DialogFrame
      panelRef={trapRef}
      role="alertdialog"
      titleId="home-fix-title"
      descriptionId="home-fix-impact home-fix-honesty"
      onDismiss={onCancel}
      onKeyDown={(event) => {
        if (
          event.key === 'Enter' &&
          !(event.target instanceof Element && event.target.closest('#home-fix-cancel'))
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      footer={
        <>
          <Button id="home-fix-cancel" tone="ghost" size="lg" onClick={onCancel}>
            {copy.cancel}
          </Button>
          <Button tone="warn" size="lg" onClick={onConfirm}>
            {copy.button}
          </Button>
        </>
      }
    >
      <h2 id="home-fix-title" style={{ ...tokens.typography.dialogTitle, margin: 0 }}>
        {title}
      </h2>
      <p id="home-fix-impact" style={{ fontSize: tokens.text.md, lineHeight: 1.5 }}>
        {step.senderCount === 1 && step.senderName ? <strong>{step.senderName}: </strong> : null}
        {fillDeck(emailCount === 1 ? copy.impactOne : copy.impactOther, {
          n: formatCount(emailCount),
        })}
      </p>
      <p
        id="home-fix-honesty"
        style={{ color: tokens.color.fgSoft, fontSize: tokens.text.sm, lineHeight: 1.5 }}
      >
        {copy.honesty}
      </p>
    </DialogFrame>
  );
}
