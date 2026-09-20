import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { UndoTrayNotice } from '@declutrmail/shared';

import {
  getInFlightActions,
  type BatchStatusResult,
  type InFlightActionGroup,
} from '@/lib/api/actions';

import { undoKeys } from './query-keys';

/** Poll cadence while something is running; idle costs nothing. */
export const IN_FLIGHT_POLL_MS = 2_000;

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

/** The pill's line for a decision still running. */
export function workingNotice(group: InFlightActionGroup): UndoTrayNotice {
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
  if (status.failed === status.total) {
    return { id, tone: 'attention', label: `${verb} failed`, who: who(group) };
  }
  if (status.failed > 0) {
    return {
      id,
      tone: 'attention',
      label: `${verb}: ${status.failed.toLocaleString('en-US')} of ${status.total.toLocaleString('en-US')} failed`,
    };
  }
  if (status.affectedCount === 0) {
    return { id, tone: 'info', label: `Nothing to ${verb.toLowerCase()}`, who: who(group) };
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
    refetchInterval: (query) =>
      query.state.status !== 'error' && (query.state.data?.length ?? 0) > 0
        ? IN_FLIGHT_POLL_MS
        : false,
    // A job finishing in a background tab must not leave "Deleting…" up.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    // A guard 4xx is a designed state, never a retry (CLAUDE.md §8).
    retry: false,
  });
}
