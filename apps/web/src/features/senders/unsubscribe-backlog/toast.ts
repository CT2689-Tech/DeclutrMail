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

function withMoveLine(verb: 'archive' | 'delete', n: number): string {
  const template =
    verb === 'delete'
      ? WS5_COPY['f1.toast.mailto.withMove.delete']
      : WS5_COPY['f1.toast.mailto.withMove.archive'];
  return fillCopy(template, { n });
}

function bulkMovedLine(verb: 'archive' | 'delete', m: number, n: number): string {
  if (verb === 'archive') return fillCopy(WS5_COPY['f1.toast.bulk'], { m, n });
  const forms = WS5_COPY['f1.toast.bulk.delete'];
  return isPluralCopy(forms) ? pluralCopy(forms, n, { m, n }) : '';
}

/**
 * Toast for one unsubscribe-backlog confirmation. Deck strings only.
 * `{m}` counts one-click requests. A mailto handoff uses the Send line
 * and never says a request was already sent.
 */
export function unsubscribeBacklogToast(result: UnsubscribeBacklogResult): string {
  const n = result.backlog?.requestedCount ?? 0;
  const verb = result.backlog?.verb ?? 'archive';
  const failed = result.senders.filter((sender) => sender.unsubStatus === 'failed');
  const manual = result.senders.filter((sender) => sender.unsubStatus === 'manual');
  const requested = result.senders.filter((sender) => sender.unsubStatus === 'requested');
  const many = result.senders.length > 1;
  const parts: string[] = [];

  if (many && result.backlog) {
    if (requested.length > 0) {
      const moved = bulkMovedLine(verb, requested.length, n);
      if (moved) parts.push(moved);
      if (manual.length > 0) parts.push(WS5_COPY['f1.toast.mailto']);
    } else if (manual.length > 0) {
      parts.push(withMoveLine(verb, n));
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

  if (result.backlog && manual.length > 0) return withMoveLine(verb, n);

  if (result.backlog) return movedLine(verb, n);

  if (manual.length > 0) return WS5_COPY['f1.toast.mailto'];

  const unsub = WS5_COPY['report.celebrate.unsub'];
  const m = Math.max(requested.length, 1);
  if (isPluralCopy(unsub)) return pluralCopy(unsub, m, { m });
  return WS5_COPY['f1.button.unsubOnly'];
}

/**
 * Activity summary for the same confirmation. One row covers every
 * sender, so any mailto handoff uses the neutral Send wording.
 */
export function unsubscribeBacklogActivityLine(result: UnsubscribeBacklogResult): string {
  if (!result.backlog) return unsubscribeBacklogToast(result);
  const n = result.backlog.requestedCount;
  const verb = result.backlog.verb;
  if (result.senders.some((sender) => sender.unsubStatus === 'manual')) {
    return withMoveLine(verb, n);
  }
  if (verb === 'delete') return fillCopy(WS5_COPY['f1.activity.row.delete'], { n });
  return fillCopy(WS5_COPY['f1.activity.row'], { n });
}
