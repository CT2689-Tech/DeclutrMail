import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { UndoTrayNotice } from '@declutrmail/shared';

import { protectedSkippedCopy } from '@/lib/action-error-copy';
import {
  getInFlightActions,
  type BatchStatusResult,
  type InFlightActionGroup,
} from '@/lib/api/actions';

import { undoKeys } from './query-keys';

/** Poll cadence while something is running; idle costs nothing. */
export const IN_FLIGHT_POLL_MS = 2_000;
/** Slower, but never stopped, while a read is failing with work still out. */
export const IN_FLIGHT_RETRY_MS = 10_000;

/** Older API builds predate `running`; there, listed means running. */
export const isRunning = (group: InFlightActionGroup): boolean => group.running !== false;

type Verb = InFlightActionGroup['verb'];

const WORKING: Record<Verb, string> = {
  archive: 'Archiving…',
  later: 'Moving to Later…',
  delete: 'Deleting…',
  unsubscribe: 'Unsubscribing…',
};

const VERB: Record<Verb, string> = {
  archive: 'Archive',
  later: 'Later',
  delete: 'Delete',
  unsubscribe: 'Unsubscribe',
};

function who(group: Pick<InFlightActionGroup, 'leadSenderName' | 'senderCount'>): string | null {
  const others = group.senderCount - 1;
  if (group.leadSenderName === null) {
    return group.senderCount > 1 ? `${group.senderCount.toLocaleString('en-US')} senders` : null;
  }
  return others > 0
    ? `${group.leadSenderName} + ${others.toLocaleString('en-US')} other${others === 1 ? '' : 's'}`
    : group.leadSenderName;
}

/**
 * The pill's line for a decision still running. `confirmed: false` = the
 * last read FAILED: what we show is the last thing we knew, so it says so
 * instead of spinning as if it were live.
 */
export function workingNotice(group: InFlightActionGroup, confirmed = true): UndoTrayNotice {
  if (!confirmed) {
    return {
      id: `run:${group.groupId}`,
      tone: 'info',
      label: `${VERB[group.verb]} not confirmed`,
      who: who(group),
    };
  }
  return {
    id: `run:${group.groupId}`,
    tone: 'working',
    label: WORKING[group.verb],
    who: who(group),
    // Jobs, not senders: a composite runs two per sender. Unit-less on purpose.
    detail:
      group.total > 1
        ? `${(group.done + group.failed).toLocaleString('en-US')} of ${group.total.toLocaleString('en-US')}`
        : null,
  };
}

/**
 * What to say once a decision has stopped running — or `null` when the
 * answer is "it worked", because then the undoable decision itself is the
 * line. `status` is `null` when the outcome could not be read.
 *
 * Unsubscribe is left out: a failed unsubscribe JOB can mean "sent, never
 * confirmed" (D248), which only its own receipt can tell apart.
 */
export function outcomeNotice(
  group: InFlightActionGroup,
  status: BatchStatusResult | null,
): Omit<UndoTrayNotice, 'onDismiss'> | null {
  if (group.verb === 'unsubscribe') return null;
  const id = `end:${group.groupId}`;
  const verb = VERB[group.verb];
  if (status === null) {
    return { id, tone: 'attention', label: `${verb} not confirmed`, who: who(group) };
  }
  // Still running server-side (it only aged out of the list): say nothing.
  if (status.status !== 'done' && status.status !== 'failed') return null;
  // D245: senders found Protected when their job ran were skipped, exactly
  // like ones protected at the click. Their jobs are left out of every
  // count here — so a one-sender skip is 0 of 0, which is not "all failed".
  const skipped = status.skippedProtectedSenderIds?.length ?? 0;
  // Beside a failure the skip is part of the line itself — an alert's
  // detail slot is not read aloud — and the group's lead sender may be the
  // skipped one, so that line names no one.
  const withSkip = (label: string): string =>
    skipped > 0 ? `${label} · ${protectedSkippedCopy(skipped)}` : label;
  if (status.total > 0 && status.failed === status.total) {
    return {
      id,
      tone: 'attention',
      label: withSkip(`${verb} failed`),
      ...(skipped > 0 ? {} : { who: who(group) }),
    };
  }
  if (status.failed > 0) {
    return {
      id,
      tone: 'attention',
      // The split counts jobs (a composite runs two per sender), so beside
      // a skip, which counts senders, it would read as a sender count.
      label:
        skipped > 0
          ? withSkip(`${verb} partly failed`)
          : `${verb}: ${status.failed.toLocaleString('en-US')} of ${status.total.toLocaleString('en-US')} failed`,
    };
  }
  if (status.affectedCount === 0) {
    // Nothing changed, so there is no Undo line to carry a skip: say it
    // here — never "Nothing to …" about mail that is still there — and,
    // when the rest ran, that it changed nothing either.
    return skipped > 0
      ? {
          id,
          tone: 'info',
          label: `${verb}: ${protectedSkippedCopy(skipped)}${status.total > 0 ? ' · nothing else changed' : ''}`,
          // The group's lead sender is only the skipped one when all were.
          ...(skipped === group.senderCount ? { who: who(group) } : {}),
        }
      : {
          id,
          tone: 'info',
          label:
            group.verb === 'later'
              ? 'Nothing to move to Later'
              : `Nothing to ${verb.toLowerCase()}`,
          who: who(group),
        };
  }
  // Mail changed: a skip rides the decision's own Undo line, whose count
  // comes with the decision itself (`GET /api/undo`).
  // Mail moved between the preview's count and the job: fewer changed than
  // were counted. The decision's own line has the real number.
  if (status.affectedCount < status.requestedCount) {
    return { id, tone: 'info', label: `${verb}: some email not changed`, who: who(group) };
  }
  return null;
}

/**
 * The user's decisions still running in this mailbox. Survives navigation
 * and reload because the server, not a screen's local state, is the source.
 *
 * Any successful mutation re-reads it: every path that starts a job (and
 * any added later) is covered without each hook having to remember.
 */
export function useInFlightActions(mailboxId?: string) {
  const qc = useQueryClient();
  useEffect(
    () =>
      qc.getMutationCache().subscribe((event) => {
        if (event.type !== 'updated' || event.mutation.state.status !== 'success') return;
        void qc.invalidateQueries({ queryKey: undoKeys.inFlight(mailboxId) });
      }),
    [qc, mailboxId],
  );
  return useQuery({
    queryKey: undoKeys.inFlight(mailboxId),
    queryFn: ({ signal }) => getInFlightActions({ signal, ...(mailboxId ? { mailboxId } : {}) }),
    refetchInterval: (query) => {
      if (!(query.state.data ?? []).some(isRunning)) return false;
      // Never stop on an error while work is out: one 5xx used to freeze
      // "Archiving…" on screen until the next click (flow gate 2026-09-20).
      return query.state.status === 'error' ? IN_FLIGHT_RETRY_MS : IN_FLIGHT_POLL_MS;
    },
    // A job finishing in a background tab must not leave "Deleting…" up.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    // A guard 4xx is a designed state, never a retry (CLAUDE.md §8).
    retry: false,
  });
}
