import { fillCopy, isPluralCopy, pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';

import type { UnsubscribeBacklogResult } from '@/lib/api/actions';

function reasonText(code: UnsubscribeBacklogResult['senders'][number]['reasonCode']): string {
  if (code === 'no_link') return WS5_COPY['f1.reason.noLink'];
  if (code === 'sender_error') return WS5_COPY['f1.reason.senderError'];
  // Short clauses of the sentences those screens already show. The
  // unsub-failed line already says "Unsubscribe failed", so the reason
  // stays a clause and does not repeat that claim.
  if (code === 'send_disabled') return 'sending is turned off in this environment';
  if (code === 'in_flight') return 'a request is already on its way';
  if (code === 'not_found') return 'the sender is no longer in this mailbox';
  // f1.reason.skipped belongs to a skip, never to this failure clause.
  // f1.reason.generic is only the fallback for a real error.
  return WS5_COPY['f1.reason.generic'];
}

function unsubFailedLine(
  verb: 'archive' | 'delete',
  n: number,
  reason: UnsubscribeBacklogResult['senders'][number]['reasonCode'],
): string {
  const forms =
    verb === 'delete'
      ? WS5_COPY['f1.toast.unsubFailed.delete']
      : WS5_COPY['f1.toast.unsubFailed.archive'];
  return isPluralCopy(forms) ? pluralCopy(forms, n, { n, reason: reasonText(reason) }) : '';
}

type BacklogSender = UnsubscribeBacklogResult['senders'][number];

/**
 * Every selected sender was skipped. Protected has its own sentence.
 * A known link or sender failure keeps that clause. Anything else,
 * including a missing reason, uses the plain skip sentence.
 */
function allSkippedLine(skipped: BacklogSender[]): string {
  if (skipped.length === 0) return '';
  const code = skipped[0]?.reasonCode;
  const same = skipped.every((sender) => sender.reasonCode === code);
  if (same && code === 'protected') {
    const forms = WS5_COPY['f1.toast.unsub.skipped'];
    return isPluralCopy(forms) ? pluralCopy(forms, skipped.length, { n: skipped.length }) : '';
  }
  if (same && code === 'no_link') return WS5_COPY['f1.reason.noLink'];
  if (same && code === 'sender_error') return WS5_COPY['f1.reason.senderError'];
  const forms = WS5_COPY['f1.toast.unsub.skipped.plain'];
  return isPluralCopy(forms) ? pluralCopy(forms, skipped.length, { n: skipped.length }) : '';
}

function bulkSkippedClause(count: number): string {
  const forms = WS5_COPY['f1.toast.bulkSkipped'];
  return isPluralCopy(forms) ? pluralCopy(forms, count, { k: count }) : '';
}

function withBulkSkipped(base: string, skippedCount: number): string {
  if (skippedCount === 0) return base;
  const clause = bulkSkippedClause(skippedCount);
  if (!clause) return base;
  return base ? `${base} · ${clause}` : clause;
}

function movedLine(verb: 'archive' | 'delete', n: number): string {
  const forms =
    verb === 'delete' ? WS5_COPY['f1.toast.both.delete'] : WS5_COPY['f1.toast.both.archive'];
  return isPluralCopy(forms) ? pluralCopy(forms, n, { n }) : '';
}

function withMoveLine(verb: 'archive' | 'delete', n: number): string {
  const forms =
    verb === 'delete'
      ? WS5_COPY['f1.toast.mailto.withMove.delete']
      : WS5_COPY['f1.toast.mailto.withMove.archive'];
  return isPluralCopy(forms) ? pluralCopy(forms, n, { n }) : '';
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
  const skipped = result.senders.filter((sender) => sender.unsubStatus === 'skipped');
  const many = result.senders.length > 1;
  const parts: string[] = [];

  if (skipped.length > 0 && skipped.length === result.senders.length) {
    return allSkippedLine(skipped);
  }

  if (many && result.backlog) {
    if (requested.length > 0) {
      const moved = bulkMovedLine(verb, requested.length, n);
      if (moved) parts.push(moved);
      if (manual.length > 0) parts.push(WS5_COPY['f1.toast.mailto']);
    } else if (manual.length > 0) {
      parts.push(withMoveLine(verb, n));
    } else if (failed.length > 0) {
      // Every unsubscribe failed, and the archive or delete still ran.
      // Name that move. bulkFailed alone would hide it. A skip is not
      // one of these failures, so its reason stays off this line.
      const failedLine = unsubFailedLine(verb, n, failed[0]?.reasonCode ?? 'generic');
      if (failedLine) parts.push(failedLine);
    }
    if (
      failed.length > 0 &&
      requested.length + manual.length > 0 &&
      isPluralCopy(WS5_COPY['f1.toast.bulkFailed'])
    ) {
      parts.push(pluralCopy(WS5_COPY['f1.toast.bulkFailed'], failed.length, { k: failed.length }));
    }
    if (skipped.length > 0) {
      const clause = bulkSkippedClause(skipped.length);
      if (clause) parts.push(clause);
    }
    return parts.filter(Boolean).join(' · ');
  }

  if (result.backlog && failed.length > 0) {
    return withBulkSkipped(
      unsubFailedLine(verb, n, failed[0]?.reasonCode ?? 'generic'),
      skipped.length,
    );
  }

  if (result.backlog && manual.length > 0) {
    return withBulkSkipped(withMoveLine(verb, n), skipped.length);
  }

  if (result.backlog) return withBulkSkipped(movedLine(verb, n), skipped.length);

  if (manual.length > 0) return withBulkSkipped(WS5_COPY['f1.toast.mailto'], skipped.length);

  // Zero one-click requests is a failure or a skip. Never claim a
  // request that was not made, and never call a skip a failure.
  if (requested.length === 0) {
    if (failed.length > 0 && isPluralCopy(WS5_COPY['f1.toast.bulkFailed'])) {
      return withBulkSkipped(
        pluralCopy(WS5_COPY['f1.toast.bulkFailed'], failed.length, { k: failed.length }),
        skipped.length,
      );
    }
    return allSkippedLine(skipped);
  }

  const unsub = WS5_COPY['report.celebrate.unsub'];
  const base = isPluralCopy(unsub)
    ? pluralCopy(unsub, requested.length, { m: requested.length })
    : WS5_COPY['f1.button.unsubOnly'];
  return withBulkSkipped(base, skipped.length);
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
  if (verb === 'delete') {
    const forms = WS5_COPY['f1.activity.row.delete'];
    return isPluralCopy(forms) ? pluralCopy(forms, n, { n }) : '';
  }
  return fillCopy(WS5_COPY['f1.activity.row'], { n });
}
