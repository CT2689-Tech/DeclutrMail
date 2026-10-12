import { isPluralCopy, pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';

import type { UnsubscribeBacklogResult } from '@/lib/api/actions';

function shownCount(n: number): string {
  return n.toLocaleString('en-US');
}

function reasonText(code: UnsubscribeBacklogResult['senders'][number]['reasonCode']): string {
  if (code === 'no_link') return WS5_COPY['f1.reason.noLink'];
  if (code === 'sender_error') return WS5_COPY['f1.reason.senderError'];
  // Short clauses. The unsub-failed line already says "Unsubscribe failed".
  if (code === 'send_disabled') return WS5_COPY['f1.reason.paused'];
  if (code === 'in_flight') return WS5_COPY['f1.reason.inFlight'];
  if (code === 'not_found') return WS5_COPY['f1.reason.notFound'];
  // Skip clauses (f1.reason.skipped and .skipped.notFound) never belong
  // inside "Unsubscribe failed". generic is only a real error.
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
  return isPluralCopy(forms)
    ? pluralCopy(forms, n, { n: shownCount(n), reason: reasonText(reason) })
    : '';
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
    return isPluralCopy(forms)
      ? pluralCopy(forms, skipped.length, { n: shownCount(skipped.length) })
      : '';
  }
  if (same && code === 'not_found') {
    const forms = WS5_COPY['f1.toast.unsub.skipped.notFound'];
    return isPluralCopy(forms)
      ? pluralCopy(forms, skipped.length, { n: shownCount(skipped.length) })
      : '';
  }
  if (same && code === 'no_link') return WS5_COPY['f1.reason.noLink'];
  if (same && code === 'sender_error') return WS5_COPY['f1.reason.senderError'];
  // mailto_only and method_unknown are not "no longer found" and are not
  // a Gmail compose that is ready. The plain skip sentence is the line.
  const forms = WS5_COPY['f1.toast.unsub.skipped.plain'];
  return isPluralCopy(forms)
    ? pluralCopy(forms, skipped.length, { n: shownCount(skipped.length) })
    : '';
}

function bulkSkippedClauses(skipped: BacklogSender[]): string[] {
  const protectedCount = skipped.filter((sender) => sender.reasonCode === 'protected').length;
  const notFoundCount = skipped.filter((sender) => sender.reasonCode === 'not_found').length;
  const noLinkCount = skipped.filter((sender) => sender.reasonCode === 'no_link').length;
  const plainCount = skipped.length - protectedCount - notFoundCount - noLinkCount;
  const clauses: string[] = [];
  const protectedForms = WS5_COPY['f1.toast.bulkSkipped'];
  const notFoundForms = WS5_COPY['f1.toast.bulkSkipped.notFound'];
  if (protectedCount > 0 && isPluralCopy(protectedForms)) {
    clauses.push(pluralCopy(protectedForms, protectedCount, { k: shownCount(protectedCount) }));
  }
  if (notFoundCount > 0 && isPluralCopy(notFoundForms)) {
    clauses.push(pluralCopy(notFoundForms, notFoundCount, { k: shownCount(notFoundCount) }));
  }
  if (noLinkCount > 0) clauses.push(WS5_COPY['f1.reason.noLink']);
  if (plainCount > 0) {
    const forms = WS5_COPY['f1.toast.unsub.skipped.plain'];
    if (isPluralCopy(forms))
      clauses.push(pluralCopy(forms, plainCount, { n: shownCount(plainCount) }));
  }
  return clauses;
}

function withSkipClauses(base: string, skipped: BacklogSender[]): string {
  const clauses = bulkSkippedClauses(skipped);
  if (clauses.length === 0) return base;
  return [base, ...clauses].filter(Boolean).join(' · ');
}

function movedLine(verb: 'archive' | 'delete', n: number): string {
  const forms =
    verb === 'delete' ? WS5_COPY['f1.toast.both.delete'] : WS5_COPY['f1.toast.both.archive'];
  return isPluralCopy(forms) ? pluralCopy(forms, n, { n: shownCount(n) }) : '';
}

function withMoveLine(verb: 'archive' | 'delete', n: number): string {
  const forms =
    verb === 'delete'
      ? WS5_COPY['f1.toast.mailto.withMove.delete']
      : WS5_COPY['f1.toast.mailto.withMove.archive'];
  return isPluralCopy(forms) ? pluralCopy(forms, n, { n: shownCount(n) }) : '';
}

/**
 * Bulk move toast, joined with ` · `.
 * `f1.toast.bulk` and `f1.toast.bulk.delete` stay in the deck and are
 * not rendered. When no one-click request was made, the mailto line
 * stands in for the unsubscribe part.
 */
function bulkMoveParts(
  verb: 'archive' | 'delete',
  requested: number,
  emails: number,
  manual: number,
): string[] {
  const parts: string[] = [];
  if (requested > 0) {
    const unsub = WS5_COPY['f1.toast.part.unsub'];
    if (isPluralCopy(unsub)) {
      parts.push(pluralCopy(unsub, requested, { m: shownCount(requested) }));
    }
  } else if (manual > 0) {
    parts.push(WS5_COPY['f1.toast.mailto']);
  }
  const moved =
    verb === 'delete' ? WS5_COPY['f1.toast.part.deleted'] : WS5_COPY['f1.toast.part.archived'];
  if (isPluralCopy(moved)) parts.push(pluralCopy(moved, emails, { n: shownCount(emails) }));
  return parts;
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
    if (requested.length > 0 || manual.length > 0) {
      parts.push(...bulkMoveParts(verb, requested.length, n, manual.length));
      if (requested.length > 0 && manual.length > 0) parts.push(WS5_COPY['f1.toast.mailto']);
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
      parts.push(
        pluralCopy(WS5_COPY['f1.toast.bulkFailed'], failed.length, {
          k: shownCount(failed.length),
        }),
      );
    }
    parts.push(...bulkSkippedClauses(skipped));
    return parts.filter(Boolean).join(' · ');
  }

  if (result.backlog && failed.length > 0) {
    return withSkipClauses(unsubFailedLine(verb, n, failed[0]?.reasonCode ?? 'generic'), skipped);
  }

  if (result.backlog && manual.length > 0) {
    return withSkipClauses(withMoveLine(verb, n), skipped);
  }

  if (result.backlog) return withSkipClauses(movedLine(verb, n), skipped);

  if (manual.length > 0) return withSkipClauses(WS5_COPY['f1.toast.mailto'], skipped);

  // Zero one-click requests is a failure or a skip. Never claim a
  // request that was not made, and never call a skip a failure.
  if (requested.length === 0) {
    if (failed.length > 0 && isPluralCopy(WS5_COPY['f1.toast.bulkFailed'])) {
      return withSkipClauses(
        pluralCopy(WS5_COPY['f1.toast.bulkFailed'], failed.length, {
          k: shownCount(failed.length),
        }),
        skipped,
      );
    }
    return allSkippedLine(skipped);
  }

  const unsub = WS5_COPY['report.celebrate.unsub'];
  const base = isPluralCopy(unsub)
    ? pluralCopy(unsub, requested.length, { m: shownCount(requested.length) })
    : WS5_COPY['f1.button.unsubOnly'];
  return withSkipClauses(base, skipped);
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
  const forms =
    verb === 'delete' ? WS5_COPY['f1.activity.row.delete'] : WS5_COPY['f1.activity.row'];
  return isPluralCopy(forms) ? pluralCopy(forms, n, { n: shownCount(n) }) : '';
}
