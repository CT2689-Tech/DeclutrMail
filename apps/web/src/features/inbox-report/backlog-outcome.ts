import { toast } from '@declutrmail/shared';

import { getActionFailureCopy } from '@/lib/action-error-copy';
import type { UnsubscribeBacklogResult } from '@/lib/api/actions';
import { ApiError } from '@/lib/api/client';
import { unsubscribeBacklogToast } from '@/features/senders/unsubscribe-backlog/toast';

import type { ReportCelebration } from './seen';

/** The same toast the Inbox Report shows after one unsubscribe-backlog confirm. */
export function toastUnsubscribeBacklog(result: UnsubscribeBacklogResult): void {
  const requested = result.senders.filter((sender) => sender.unsubStatus === 'requested').length;
  const manual = result.senders.filter((sender) => sender.unsubStatus === 'manual').length;
  const line = unsubscribeBacklogToast(result);
  if (line !== '') toast(line, requested + manual > 0 ? 'info' : 'warn');
}

/**
 * What the report stores so Activity's undo token can be polled later.
 * Nothing was sent and nothing moved: no celebration, no undo.
 */
export function celebrationFromUnsubscribeBacklog(
  result: UnsubscribeBacklogResult,
  fix?: { senderKeys: readonly string[]; generatedAt?: string | undefined },
): ReportCelebration | null {
  const requested = result.senders.filter((sender) => sender.unsubStatus === 'requested').length;
  const manual = result.senders.filter((sender) => sender.unsubStatus === 'manual').length;
  const moved = result.backlog !== null && result.backlog.requestedCount > 0;
  if (!moved && requested === 0 && manual === 0) return null;
  const verb = moved ? (result.backlog?.verb === 'delete' ? 'delete' : 'archive') : 'unsub_only';
  const handle = result.backlog?.handle;
  const senderKeys = fix?.senderKeys.filter((id) => id !== '');
  return {
    archived: result.backlog?.requestedCount ?? 0,
    senders: requested + manual,
    verb,
    requested,
    manual,
    ...(verb === 'delete' && typeof result.backlog?.movedBytes === 'number'
      ? { bytes: result.backlog.movedBytes }
      : {}),
    ...(verb === 'archive' &&
    result.backlog?.actionId &&
    (handle === 'action' || handle === 'batch')
      ? { actionId: result.backlog.actionId, actionHandle: handle }
      : {}),
    ...(senderKeys !== undefined && senderKeys.length > 0 ? { senderKeys: [...senderKeys] } : {}),
    ...(senderKeys !== undefined &&
    senderKeys.length > 0 &&
    typeof fix?.generatedAt === 'string' &&
    fix.generatedAt !== ''
      ? { fixGeneratedAt: fix.generatedAt }
      : {}),
  };
}

/** A 402 means nothing was sent. Every other failure says so. */
export function toastUnsubscribeBacklogFailure(err: unknown): void {
  if (err instanceof ApiError && err.status === 402) return;
  toast(
    getActionFailureCopy('enqueue', {
      action: 'Unsubscribe',
      outcome: 'no request was sent',
      error: err,
    }),
    'warn',
  );
}
