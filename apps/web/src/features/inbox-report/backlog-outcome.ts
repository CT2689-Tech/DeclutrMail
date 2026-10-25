import { toast } from '@declutrmail/shared';

import { getActionFailureCopy } from '@/lib/action-error-copy';
import type { UnsubscribeBacklogResult } from '@/lib/api/actions';
import { ApiError } from '@/lib/api/client';
import { unsubscribeBacklogSubmissionToast } from '@/features/senders/unsubscribe-backlog/toast';

/** The same toast the Inbox Report shows after one unsubscribe-backlog confirm. */
export function toastUnsubscribeBacklog(result: UnsubscribeBacklogResult): void {
  const requested = result.senders.filter((sender) => sender.unsubStatus === 'requested').length;
  const manual = result.senders.filter((sender) => sender.unsubStatus === 'manual').length;
  const line = unsubscribeBacklogSubmissionToast(result);
  if (line !== '') toast(line, requested + manual > 0 ? 'info' : 'warn');
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
