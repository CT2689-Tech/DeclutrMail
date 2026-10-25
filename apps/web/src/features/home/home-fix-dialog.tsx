'use client';

import Link from 'next/link';
import { useBulkActionPreview, useCompositePreview } from '@/lib/api/use-action';

import { Button, DialogFrame, tokens } from '@declutrmail/shared';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';

import { HOME_DECK, fillDeck, formatCount } from './home-deck-copy';
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
export function HomeFixDialog(props: {
  step: HomeFixCandidate;
  mailboxId?: string | undefined;
  onCancel: () => void;
  onConfirm: (step: HomeFixCandidate) => void;
}) {
  return props.mailboxId ? (
    <LiveHomeFixDialog {...props} mailboxId={props.mailboxId} />
  ) : (
    <HomeFixPreview
      step={props.step}
      onCancel={props.onCancel}
      onConfirm={() => props.onConfirm(props.step)}
    />
  );
}

function LiveHomeFixDialog({
  step,
  mailboxId,
  onCancel,
  onConfirm,
}: {
  step: HomeFixCandidate;
  mailboxId: string;
  onCancel: () => void;
  onConfirm: (step: HomeFixCandidate) => void;
}) {
  const ids = [...step.senderIds];
  const single = ids.length === 1;
  const composite = useCompositePreview(single ? ids[0]! : null, mailboxId);
  const bulk = useBulkActionPreview(single ? null : ids, mailboxId);
  const query = single ? composite : bulk;
  const rows = single
    ? composite.data && !composite.data.protected && composite.data.unsubAvailable
      ? [{ senderId: composite.data.sender.id, counts: composite.data.counts }]
      : []
    : (bulk.data?.senders.filter((row) => !row.protected && ids.includes(row.senderId)) ?? []);
  const count = rows.reduce((sum, row) => sum + row.counts.all, 0);
  const ready =
    query.isSuccess && !query.isFetching && Number.isFinite(count) && count > 0 && rows.length > 0;
  const current = ready
    ? {
        ...step,
        senderIds: rows.map((row) => row.senderId),
        senderCount: rows.length,
        emailCount: count,
      }
    : step;
  return (
    <HomeFixPreview
      step={current}
      onCancel={onCancel}
      onConfirm={() => {
        if (ready) onConfirm(current);
      }}
      previewState={
        query.isFetching || query.isPending
          ? 'loading'
          : query.isError
            ? 'error'
            : ready
              ? 'ready'
              : 'empty'
      }
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}

function HomeFixPreview({
  step,
  onCancel,
  onConfirm,
  previewState = 'ready',
  onRetry,
}: {
  step: HomeFixCandidate;
  onCancel: () => void;
  onConfirm: () => void;
  previewState?: 'ready' | 'loading' | 'error' | 'empty';
  onRetry?: () => void;
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
          event.target instanceof Element &&
          event.target.closest('#home-fix-confirm')
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
          <Button
            id="home-fix-confirm"
            tone="warn"
            size="lg"
            onClick={onConfirm}
            disabled={previewState !== 'ready'}
          >
            {copy.button}
          </Button>
        </>
      }
    >
      <h2 id="home-fix-title" style={{ ...tokens.typography.dialogTitle, margin: 0 }}>
        {title}
      </h2>
      <div id="home-fix-impact" aria-live="polite">
        {previewState === 'ready' ? (
          <p style={{ fontSize: tokens.text.md, lineHeight: 1.5 }}>
            {step.senderCount === 1 && step.senderName ? (
              <strong>{step.senderName}: </strong>
            ) : null}
            {fillDeck(emailCount === 1 ? copy.impactOne : copy.impactOther, {
              n: formatCount(emailCount),
            })}
          </p>
        ) : previewState === 'loading' ? (
          <p role="status">{HOME_DECK.focus.previewLoading}</p>
        ) : previewState === 'error' ? (
          <>
            <p>{HOME_DECK.focus.previewError}</p>
            <Button tone="ghost" onClick={() => onRetry?.()}>
              {HOME_DECK.failedRetry}
            </Button>
          </>
        ) : (
          <>
            <p>{HOME_DECK.focus.previewEmpty}</p>
            <Link href="/senders">{HOME_DECK.focus.review}</Link>
          </>
        )}
      </div>
      <p
        id="home-fix-honesty"
        style={{ color: tokens.color.fgSoft, fontSize: tokens.text.sm, lineHeight: 1.5 }}
      >
        {copy.honesty}
      </p>
    </DialogFrame>
  );
}
