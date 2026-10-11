import { fillCopy, isPluralCopy, pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';

import type { UnsubscribeBacklogResult } from '@/lib/api/actions';

function reasonText(code: UnsubscribeBacklogResult['senders'][number]['reasonCode']): string {
  if (code === 'no_link') return WS5_COPY['f1.reason.noLink'];
  if (code === 'sender_error') return WS5_COPY['f1.reason.senderError'];
  return WS5_COPY['f1.reason.generic'];
}

function movedLine(verb: 'archive' | 'delete', n: number): string {
  const forms =
    verb === 'delete' ? WS5_COPY['f1.toast.both.delete'] : WS5_COPY['f1.toast.both.archive'];
  return isPluralCopy(forms) ? pluralCopy(forms, n, { n }) : '';
}

/**
 * Toast for one unsubscribe-backlog confirmation. Deck strings only.
 *
 * Missing deck keys (do not invent them):
 * - `f1.toast.bulk.delete` — `f1.toast.bulk` names Archive only
 * - a single sentence for a backlog move plus the mailto handoff
 */
export function unsubscribeBacklogToast(result: UnsubscribeBacklogResult): string {
  const n = result.backlog?.requestedCount ?? 0;
  const verb = result.backlog?.verb ?? 'archive';
  const failed = result.senders.filter((sender) => sender.unsubStatus === 'failed');
  const manual = result.senders.filter((sender) => sender.unsubStatus === 'manual');
  const requested = result.senders.filter(
    (sender) => sender.unsubStatus === 'requested' || sender.unsubStatus === 'manual',
  );
  const many = result.senders.length > 1;
  const parts: string[] = [];

  if (many && result.backlog) {
    if (verb === 'archive') {
      parts.push(fillCopy(WS5_COPY['f1.toast.bulk'], { m: requested.length, n }));
    } else {
      const moved = movedLine('delete', n);
      if (moved) parts.push(moved);
    }
    if (failed.length > 0 && isPluralCopy(WS5_COPY['f1.toast.bulkFailed'])) {
      parts.push(pluralCopy(WS5_COPY['f1.toast.bulkFailed'], failed.length, { k: failed.length }));
    }
    return parts.filter(Boolean).join(' · ');
  }

  if (result.backlog && failed.length > 0) {
    const forms =
      verb === 'delete'
        ? WS5_COPY['f1.toast.unsubFailed.delete']
        : WS5_COPY['f1.toast.unsubFailed.archive'];
    if (isPluralCopy(forms)) {
      return pluralCopy(forms, n, { n, reason: reasonText(failed[0]?.reasonCode ?? 'generic') });
    }
  }

  if (result.backlog && manual.length > 0) {
    const moved = movedLine(verb, n);
    if (moved) parts.push(moved);
    parts.push(WS5_COPY['f1.toast.mailto']);
    return parts.join(' ');
  }

  if (result.backlog) return movedLine(verb, n);

  if (manual.length > 0) return WS5_COPY['f1.toast.mailto'];

  const unsub = WS5_COPY['report.celebrate.unsub'];
  const m = Math.max(requested.length, 1);
  if (isPluralCopy(unsub)) return pluralCopy(unsub, m, { m });
  return WS5_COPY['f1.button.unsubOnly'];
}
