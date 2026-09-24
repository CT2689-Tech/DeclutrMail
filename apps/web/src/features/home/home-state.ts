/**
 * Pure state composition for Home — recorded progress and available review tasks.
 *
 * Every number here names the field that backs it:
 *
 *   - "emails cleared"  = `emailsByVerb.archive + emailsByVerb.delete`
 *     (`SUM(activity_log.affected_count)`, undone rows excluded). Later is
 *     left out on purpose: that mail returns to the inbox when it wakes,
 *     so it was deferred, not cleared.
 *   - "senders decided" = `decidedSenders`.
 *   - the button counts = the length of Triage's served queue and
 *     Screener's `pending`, the same reads those screens render.
 *
 * Nothing is derived beyond a sum of two served fields, and a zero is
 * never shown as an achievement — no cleared mail falls back to senders
 * decided, and no decisions at all is the `empty` state.
 */

import type { HomeSenderPreview } from './api/use-home-pending';
import type { HomeSummary } from './api/use-home-summary';

export interface HomeAction {
  label: string;
  href: string;
}

export interface HomeStat {
  label: string;
  value: number;
}

export type HomeState =
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown; retry: () => void }
  | { kind: 'empty'; syncing: boolean; action: HomeAction; senders?: HomeSenderPreview[] }
  /** The active mailbox's first scan failed terminally (`readiness === 'failed'`) and nothing is decided. */
  | { kind: 'sync-failed' }
  | {
      kind: 'ready';
      pending?: HomeActionInput;
      senders?: HomeSenderPreview[];
      hero: HomeStat;
      /** ISO instant of the earliest counted action. */
      since: string | null;
      secondary: HomeStat[];
      action: HomeAction;
    };

export interface HomeActionInput {
  /** Pending Triage decisions; null when the tier has no Triage or the read failed. */
  triagePending: number | null;
  /** Pending Screener senders; null when the tier has no Screener or the read failed. */
  screenerPending: number | null;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * Where a failed scan is retried or the mailbox reconnected — Settings →
 * Gmail accounts, the same destination Triage's failed-scan state uses.
 */
export const SYNC_FAILED_ACTION: HomeAction = {
  label: 'Open Settings',
  href: '/settings#mailboxes',
};

export function composeHomeAction({ triagePending, screenerPending }: HomeActionInput): HomeAction {
  if (triagePending !== null && triagePending > 0) {
    return {
      // "today": the count is Triage's daily-clamped queue, not every waiting sender.
      label: `Review ${triagePending.toLocaleString('en-US')} today`,
      href: '/triage',
    };
  }
  if (screenerPending !== null && screenerPending > 0) {
    return {
      label: `Review ${screenerPending.toLocaleString('en-US')} new`,
      href: '/screener',
    };
  }
  return { label: 'Review senders', href: '/senders' };
}

export function composeHomeNumbers(
  summary: HomeSummary,
): Pick<Extract<HomeState, { kind: 'ready' }>, 'hero' | 'secondary'> | null {
  const archived = summary.emailsByVerb?.archive ?? 0;
  const deleted = summary.emailsByVerb?.delete ?? 0;
  const cleared = archived + deleted;
  const decided = summary.decidedSenders;

  if (cleared > 0) {
    const secondary: HomeStat[] = [];
    // The split only says something when both verbs contributed —
    // otherwise one of them just repeats the hero.
    if (archived > 0 && deleted > 0) {
      secondary.push(
        { label: plural(archived, 'Email archived', 'Emails archived'), value: archived },
        { label: plural(deleted, 'Email deleted', 'Emails deleted'), value: deleted },
      );
    }
    if (decided > 0) {
      secondary.push({
        label: plural(decided, 'Sender decided', 'Senders decided'),
        value: decided,
      });
    }
    return {
      hero: { label: plural(cleared, 'email cleared', 'emails cleared'), value: cleared },
      secondary,
    };
  }
  if (decided > 0) {
    return {
      hero: { label: plural(decided, 'sender decided', 'senders decided'), value: decided },
      secondary: [],
    };
  }
  return null;
}
