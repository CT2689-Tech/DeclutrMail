'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { Button, Kbd, tokens, useIsAtMost } from '@declutrmail/shared';

import { MailboxActionContext } from '@/features/auth/mailbox-action-context';
import { isTypingTarget } from '@/features/senders/keyboard';
import type { PreviewCount } from './action-preview';
import type { ActionPreviewDetail } from './action-preview-detail';
import type { TriageDecisionRow } from './data';
import type { DomainBatch } from './domain-batch';
import { DomainBatchCard, type BatchVerb } from './domain-batch-card';
import { TriageFocusCard } from './focus-card';
import { focusItemKey, type FocusItem } from './focus-plan';
import { useTriageStore } from './store';
import { inlinePreviewFor } from './triage-queue';
import type { ActionVerb } from './types';
import { UnprotectButton } from './unprotect-button';

const { motion } = tokens;

/**
 * Skip's binding: → only. No letter — the shortcut row is K/A/U/L/D
 * (D227), and `S` is the letter that rule retired with "Screen".
 */
export function isSkipKey(e: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key === 'ArrowRight';
}

/**
 * Focus mode's stage: the current item of the stack (a sender, or a
 * batch offer as its own card) plus Skip.
 *
 * Stateless about the queue — `triage-screen.tsx` plans the stack and
 * owns the skip list, because the header's "3 of 12" reads the same
 * position. Every verb leaves through the callbacks the list uses.
 */
export function TriageFocusStack({
  item,
  canSkip,
  onSkip,
  onAction,
  busyRowIds,
  previewInboxCount,
  previewDetail,
  previewQuotaRemaining,
  onBatchVerb,
  batchBusyDomain,
}: {
  item: FocusItem;
  /** False when this is the only item — there is nowhere to skip to. */
  canSkip: boolean;
  onSkip: () => void;
  onAction: (verb: ActionVerb, row: TriageDecisionRow) => void;
  busyRowIds: ReadonlySet<string>;
  previewInboxCount: PreviewCount;
  previewDetail: ActionPreviewDetail | undefined;
  previewQuotaRemaining: number | null | undefined;
  onBatchVerb: (verb: BatchVerb, batch: DomainBatch) => void;
  batchBusyDomain: string | null;
}) {
  const isNarrow = useIsAtMost('xs');
  const expandedRowId = useTriageStore((s) => s.expandedRowId);
  const toggleExpandedRow = useTriageStore((s) => s.toggleExpandedRow);
  const pendingAction = useTriageStore((s) => s.pendingAction);
  const dismissBatchDomain = useTriageStore((s) => s.dismissBatchDomain);

  useEffect(() => {
    if (!canSkip) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isSkipKey(e) || isTypingTarget(e.target)) return;
      // A sheet owns the keyboard while it is open — Skip must not pull
      // the sender out from under a D226 preview.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      onSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSkip, onSkip]);

  const stageRef = useCardExit(focusItemKey(item));

  let card;
  if (item.kind === 'row') {
    const row = item.row;
    card = (
      <TriageFocusCard
        row={row}
        busy={busyRowIds.has(row.id)}
        whyOpen={expandedRowId === row.id}
        onToggleWhy={() => toggleExpandedRow(row.id)}
        onAction={(verb) => onAction(verb, row)}
        inlinePreview={inlinePreviewFor(row.id, pendingAction, {
          inboxCount: previewInboxCount,
          detail: previewDetail,
          quotaRemaining: previewQuotaRemaining,
        })}
        inlinePreviewAccountContext={<MailboxActionContext />}
        // Constructed here (not inside the card) — same reason as the
        // list: the card stays free of the sender-policy mutation.
        unprotectSlot={
          row.protectionReason == null ? undefined : (
            <UnprotectButton row={row} surface="triage-preview" />
          )
        }
      />
    );
  } else {
    const batch = item.batch;
    // The same-verdict offer groups senders by what the engine suggests,
    // not by a domain; it offers that one verb.
    const verdictVerb: BatchVerb | null =
      item.kind === 'verdict' ? (item.verdict === 'archive' ? 'Archive' : 'Later') : null;
    card = (
      <DomainBatchCard
        variant="focus"
        batch={batch}
        {...(verdictVerb !== null
          ? { headline: `senders suggested for ${verdictVerb}`, verbs: [verdictVerb] }
          : {})}
        busy={batchBusyDomain === batch.domain}
        disabled={
          busyRowIds.size > 0 || (batchBusyDomain != null && batchBusyDomain !== batch.domain)
        }
        onVerb={(verb) => onBatchVerb(verb, batch)}
        onDismiss={() => dismissBatchDomain(batch.domain)}
      />
    );
  }

  const itemKey = focusItemKey(item);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{SWAP_KEYFRAMES}</style>
      <div ref={stageRef} style={{ position: 'relative' }}>
        {/* Keyed so the next item mounts fresh and plays the entrance
            from the right; the departing card leaves to the left as an
            inert snapshot (`useCardExit`). Reduced motion is handled
            globally (tokens.css). */}
        <div
          key={itemKey}
          data-dm-focus-item={itemKey}
          style={{ animation: `dm-triage-focus-in ${motion.base} ${motion.ease} both` }}
        >
          {card}
        </div>
      </div>
      {canSkip && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Button
            tone="ghost"
            size={isNarrow ? 'lg' : 'md'}
            onClick={onSkip}
            ariaLabel="Skip (→)"
            {...(isNarrow ? { style: { minWidth: 120 } } : { iconRight: <Kbd>→</Kbd> })}
          >
            Skip
          </Button>
        </div>
      )}
      {/* The card swaps without focus moving, so AT needs telling. */}
      <span aria-live="polite" style={{ position: 'absolute', left: -9999 }}>
        {item.kind === 'row' ? `Now deciding ${item.row.senderName}` : 'Now deciding a batch offer'}
      </span>
    </div>
  );
}

const SWAP_KEYFRAMES = `@keyframes dm-triage-focus-in { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: none; } }
@keyframes dm-triage-focus-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateX(-12px); } }`;

/** How long the departing snapshot stays — `motion.base`, in ms. */
const EXIT_MS = 220;

/**
 * The departing card's exit. React has already unmounted it by the time
 * the key changes, so the stage keeps a DOM snapshot of the last card it
 * rendered and, on a swap, plays that snapshot out to the left.
 *
 * A snapshot, never a second React card: a mounted card carries the
 * K/A/U/L/D listener, and two listeners is how one key press once
 * decided two senders. The clone has no React handlers, no ids, and is
 * `inert` + `aria-hidden`, so it is paint only.
 *
 * Only when the environment affirmatively reports no motion preference —
 * reduced motion (and a test DOM without `matchMedia`) gets the plain
 * swap.
 */
function useCardExit(itemKey: string) {
  const stageRef = useRef<HTMLDivElement>(null);
  const snapshot = useRef<{ key: string; node: HTMLElement } | null>(null);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (stage == null) return;
    const prev = snapshot.current;
    const current = stage.querySelector<HTMLElement>('[data-dm-focus-item]');
    snapshot.current =
      current == null ? null : { key: itemKey, node: current.cloneNode(true) as HTMLElement };
    if (prev == null || prev.key === itemKey) return;
    const animate =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
    if (!animate) return;
    const ghost = prev.node;
    ghost.removeAttribute('data-dm-focus-item');
    for (const el of ghost.querySelectorAll('[id]')) el.removeAttribute('id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.setAttribute('inert', '');
    Object.assign(ghost.style, {
      position: 'absolute',
      inset: '0 0 auto 0',
      pointerEvents: 'none',
      animation: `dm-triage-focus-out ${motion.base} ${motion.ease} both`,
    });
    stage.appendChild(ghost);
    const timer = window.setTimeout(() => ghost.remove(), EXIT_MS);
    return () => {
      window.clearTimeout(timer);
      ghost.remove();
    };
  }, [itemKey]);

  // Keep the snapshot current as the card changes in place (busy dim,
  // an opened "Why?"), so the exit shows the card as it last looked.
  useEffect(() => {
    const current = stageRef.current?.querySelector<HTMLElement>('[data-dm-focus-item]');
    if (current != null) {
      snapshot.current = { key: itemKey, node: current.cloneNode(true) as HTMLElement };
    }
  });

  return stageRef;
}
