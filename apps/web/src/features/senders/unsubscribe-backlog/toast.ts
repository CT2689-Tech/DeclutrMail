import { fillCopy, isPluralCopy, pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';

import type { UnsubscribeBacklogResult } from '@/lib/api/actions';

function reasonText(code: UnsubscribeBacklogResult['senders'][number]['reasonCode']): string {
  if (code === 'no_link') return WS5_COPY['f1.reason.noLink'];
  if (code === 'sender_error') return WS5_COPY['f1.reason.senderError'];
  return WS5_COPY['f1.reason.generic'];
}

/** Toast for one unsubscribe-backlog confirmation. Deck strings only. */
export function unsubscribeBacklogToast(result: UnsubscribeBacklogResult): string {
  const n = result.backlog?.requestedCount ?? 0;
  const verb = result.backlog?.verb ?? 'archive';
  const failed = result.senders.filter((sender) => sender.unsubStatus === 'failed');
  const manual = result.senders.filter((sender) => sender.unsubStatus === 'manual');
  const requested = result.senders.filter(
    (sender) => sender.unsubStatus === 'requested' || sender.unsubStatus === 'manual',
  );
  const many = result.senders.length > 1;

  if (many && result.backlog) {
    const bulk = WS5_COPY['f1.toast.bulkFailed'];
    let line = fillCopy(WS5_COPY['f1.toast.bulk'], { m: requested.length, n });
    if (verb === 'delete') line = line.replace('Archived', 'Deleted');
    if (failed.length > 0 && isPluralCopy(bulk)) {
      line = `${line} · ${pluralCopy(bulk, failed.length, { k: failed.length })}`;
    }
    return line;
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
    const moved = verb === 'delete' ? 'Deleted' : 'Archived';
    const count = n === 1 ? '1 email' : `${n} emails`;
    return `${moved} ${count} · ${WS5_COPY['f1.toast.mailto']}`;
  }

  if (result.backlog) {
    const forms =
      verb === 'delete' ? WS5_COPY['f1.toast.both.delete'] : WS5_COPY['f1.toast.both.archive'];
    if (isPluralCopy(forms)) return pluralCopy(forms, n, { n });
  }

  if (manual.length > 0) return WS5_COPY['f1.toast.mailto'];

  const unsub = WS5_COPY['report.celebrate.unsub'];
  const m = Math.max(requested.length, 1);
  if (isPluralCopy(unsub)) return pluralCopy(unsub, m, { m });
  return WS5_COPY['f1.button.unsubOnly'];
}
