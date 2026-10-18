import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { UndoTrayNotice } from '@declutrmail/shared';

import { getActionFailureCopy, protectedSkippedCopy } from '@/lib/action-error-copy';
import {
  cleanupBatchStatus,
  getInFlightActions,
  getBatchStatus,
  isTerminalStatus,
  type BatchStatusResult,
  type InFlightActionGroup,
} from '@/lib/api/actions';

import { undoKeys } from './query-keys';
import {
  pendingActionFeedback,
  observeActionFeedback,
  useActionFeedbackStore,
} from './feedback-store';

/** Poll cadence while something is running; idle costs nothing. */
export const IN_FLIGHT_POLL_MS = 2_000;
/** Slower, but never stopped, while a read is failing with work still out. */
export const IN_FLIGHT_RETRY_MS = 10_000;
/** Same deadline used by local action handles to park slow work. */
export const ACTION_OVERDUE_MS = 120_000;

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
      tone: 'attention',
      verb: group.verb,
      label: getActionFailureCopy('status', { action: VERB[group.verb] }),
      who: who(group),
    };
  }
  return {
    id: `run:${group.groupId}`,
    tone: 'working',
    verb: group.verb,
    label: `${Date.now() - Date.parse(group.startedAt) >= ACTION_OVERDUE_MS ? 'Taking longer than usual · ' : ''}${group.mixedVerbs ? 'Working…' : WORKING[group.verb]}`,
    who: who(group),
    // Only a one-job-per-sender decision can call its fraction senders.
    detail:
      group.senderCount > 1 && group.total > 1
        ? `${(group.done + group.failed).toLocaleString('en-US')} of ${group.total.toLocaleString('en-US')} ${!group.mixedVerbs && group.total === group.senderCount ? 'senders' : 'steps'}`
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
    return {
      id,
      tone: 'attention',
      label: getActionFailureCopy('status', { action: verb }),
      who: who(group),
    };
  }
  // Still running server-side (it only aged out of the list): say nothing.
  if (status.status !== 'done' && status.status !== 'failed') return null;
  // One confirmation, two independent outcomes. Job failure counts include
  // unconfirmed unsubscribes; they must never label a successful move failed.
  const unsub = status.unsubscribeOutcomes;
  if (status.feedbackVersion === 2 && unsub && unsub.pending === 0) {
    const unsubscribeTotal = unsub.endpointAccepted + unsub.unconfirmed + unsub.failed;
    if (unsubscribeTotal > 0) {
      const move = outcomeNotice(group, cleanupBatchStatus(status));
      const label = combinedUnsubscribeLine(unsub);
      return move
        ? { ...move, label: `${move.label} · ${label}` }
        : {
            id,
            groupId: group.groupId,
            tone: unsub.unconfirmed + unsub.failed > 0 ? 'attention' : 'info',
            label,
          };
    }
  }
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
      ...(status.affectedCount > 0 ? { groupId: group.groupId } : {}),
      tone: 'attention',
      // The split counts jobs (a composite runs two per sender), so beside
      // a skip, which counts senders, it would read as a sender count.
      label:
        skipped > 0
          ? withSkip(`${verb} partly failed`)
          : !group.mixedVerbs && status.total === group.senderCount
            ? `${verb}: ${status.failed.toLocaleString('en-US')} of ${status.total.toLocaleString('en-US')} senders failed`
            : `${verb} partly failed — check Activity.`,
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
  // comes with the decision itself (`GET /api/undo`). Fewer than the
  // preview counted means mail had already left the inbox, not that some
  // was left behind: the decision's own line has the real number, and a
  // notice here would sit above its Undo.
  return null;
}

function combinedUnsubscribeLine(
  outcomes: NonNullable<BatchStatusResult['unsubscribeOutcomes']>,
): string {
  const { endpointAccepted, unconfirmed, failed } = outcomes;
  const manual = outcomes.actionRequired ?? 0;
  const total = endpointAccepted + unconfirmed + failed;
  if (total === 1) {
    if (unconfirmed) return 'Unsubscribe unconfirmed — watch for new email.';
    if (manual) return 'Unsubscribe needs an email from Gmail.';
    if (failed) return 'Unsubscribe failed — see Activity.';
    return 'Unsubscribe request accepted.';
  }
  return [
    ...(endpointAccepted ? [`${endpointAccepted} unsubscribe requests accepted`] : []),
    ...(unconfirmed ? [`${unconfirmed} unconfirmed — watch for new email`] : []),
    ...(manual ? [`${manual} need an email from Gmail`] : []),
    ...(failed > manual ? [`${failed - manual} unsubscribe requests failed`] : []),
  ].join(' · ');
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
  // The first progress read after acceptance can fail before we know any
  // server groups. Preserve a visible unknown state and retry that read too.
  const unobservedAcceptance = useActionFeedbackStore((state) => {
    const scope = state.scopes[mailboxId ?? 'active-mailbox'];
    return (scope?.length ?? 0) > 0;
  });
  useEffect(
    () =>
      qc.getMutationCache().subscribe((event) => {
        if (event.type !== 'updated' || event.mutation.state.status !== 'success') return;
        void qc.invalidateQueries({ queryKey: undoKeys.inFlight(mailboxId) });
      }),
    [qc, mailboxId],
  );
  const query = useQuery({
    queryKey: undoKeys.inFlight(mailboxId),
    queryFn: async ({ signal }) => {
      const groups = await getInFlightActions({ signal, ...(mailboxId ? { mailboxId } : {}) });
      // Read accepted handles AFTER discovery: its initial request may
      // have captured an empty snapshot before the enqueue completed.
      // A job can also finish and age out while discovery is unavailable.
      // An empty list cannot settle either case; read the accepted handle.
      const pending = pendingActionFeedback(mailboxId);
      const listed = new Set(groups.map((group) => group.groupId));
      const recovered = await Promise.all(
        pending
          .filter((item) => !listed.has(item.groupId))
          .map(async (item): Promise<InFlightActionGroup> => {
            const status = await getBatchStatus(item.groupId, {
              signal,
              ...(mailboxId ? { mailboxId } : {}),
            });
            return {
              ...item,
              leadSenderName: null,
              total: status.total,
              done: status.done,
              failed: status.failed,
              running: !isTerminalStatus(status.status),
            };
          }),
      );
      // Failed reads keep the handles and the unknown/retry state intact.
      observeActionFeedback(mailboxId, new Set(pending.map((item) => item.groupId)));
      groups.push(...recovered);
      return groups;
    },
    refetchInterval: (query) => {
      if (!(query.state.data ?? []).some(isRunning) && !unobservedAcceptance) return false;
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
  return { ...query, unconfirmedAcceptance: query.isError && unobservedAcceptance };
}

/**
 * Senders/senderKeys with a live forward job RIGHT NOW, across every
 * surface and tab — server truth, so it survives navigation, sort/filter,
 * and mailbox switch where a component's own local state does not.
 *
 * Additive to, never a replacement for, a surface's own "I just fired
 * this" local flag: the click → committed-row → next-poll round trip is
 * real latency this hook cannot close synchronously. What it replaces is
 * the PERSISTENCE half of the old per-surface state — the part that was
 * supposed to survive navigation/timeout and didn't.
 *
 * Deliberately excludes any group with `running: false`: that state means
 * every job in the group already reached a terminal status and the group
 * is listed only for `IN_FLIGHT_SETTLED_GRACE_SECONDS` so a tray can
 * report how it ended. Including it here would reopen the exact "pill
 * says done, row still reads busy" bug this hook exists to fix.
 */
export function useSenderInFlightLock(mailboxId?: string) {
  const { data } = useInFlightActions(mailboxId);
  return useMemo(() => {
    const senderIds = new Set<string>();
    const senderKeys = new Set<string>();
    for (const group of data ?? []) {
      if (!isRunning(group)) continue;
      for (const id of group.senderIds ?? []) senderIds.add(id);
      for (const key of group.senderKeys ?? []) senderKeys.add(key);
    }
    return { senderIds, senderKeys };
  }, [data]);
}
