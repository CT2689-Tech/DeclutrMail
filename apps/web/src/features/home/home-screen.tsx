'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  reportHeadline,
  reportSupport,
  type InboxReportDto,
} from '@declutrmail/shared/inbox-report';

import { activityKeys } from '@/features/activity/api/query-keys';
import { useAuth } from '@/features/auth/auth-provider';
import { useTier } from '@/features/auth/api/use-tier';
import {
  celebrationFromUnsubscribeBacklog,
  toastUnsubscribeBacklog,
  toastUnsubscribeBacklogFailure,
} from '@/features/inbox-report/backlog-outcome';
import { writeReportCelebration } from '@/features/inbox-report/seen';
import { isMailboxScopeConflict } from '@/features/mailboxes/api/reset-mailbox-cache';
import { NoActiveMailbox } from '@/features/mailboxes/no-active-mailbox';
import { undoKeys } from '@/features/undo/query-keys';

import { useCleanupSummary } from '@/features/billing/use-cleanup-summary';
import { useSyncStatus } from '@/features/onboarding/api/use-sync-status';
import { inProgressStageSentence } from '@/features/onboarding/sync-stage-copy';
import { apiGet } from '@/lib/api/client';
import {
  useActionStatus,
  useBatchStatus,
  useConfirmUnsubscribeBacklog,
} from '@/lib/api/use-action';
import { fetchSnoozed } from '@/lib/api/snoozed';
import { snoozedListQueryOptions } from '@/features/snoozed/api/query-options';

import { homeInboxReportQueryOptions } from './api/query-options';
import { useHomeSummary } from './api/use-home-summary';
import { HomeArrivals } from './home-arrivals';
import {
  homeCandidatesFromReport,
  homeLaterCandidate,
  rankHomeNextSteps,
  type HomeFixCandidate,
} from './home-next-steps';
import { composeHomeNumbers, type HomeState } from './home-state';
import { HomeView } from './home-view';

/**
 * Home — the landing screen. Container (D198): wires the reads, composes
 * one `HomeState`, hands it to `HomeView`.
 *
 * | state                         | UI                               |
 * |-------------------------------|----------------------------------|
 * | summary / pending in flight   | skeleton                         |
 * | guard 409 (mailbox unresolved)| `NoActiveMailbox` — the global   |
 * |                               | QueryCache handler also resets   |
 * |                               | the scoped cache off this error  |
 * | other summary failure         | ErrorState + retry               |
 * | no decisions, still syncing   | title, status, scan bar          |
 * | no decisions, scan failed     | "The scan stopped" + retry       |
 * | no decisions                  | "Nothing cleared yet" + button   |
 * | decisions                     | number + label + button          |
 *
 * A mailbox switch needs nothing here: `resetMailboxScopedCache`
 * invalidates every query, these included.
 */
/** F2's size field is not on main, so the Largest card stays off. */
const SENDER_SIZE_VIEW = false;

interface ArchiveMove {
  id: string;
  handle: 'action' | 'batch';
}

/** Poll the archive Home just confirmed so the tray can offer Undo. */
function useHomeArchiveUndo(mailboxId: string | null, move: ArchiveMove | null) {
  const batch = move?.handle === 'batch';
  const scoped = mailboxId !== null ? mailboxId : undefined;
  useActionStatus(move && !batch ? move.id : null, scoped);
  useBatchStatus(move && batch ? move.id : null, scoped);
}

export function HomeScreen() {
  const { me } = useAuth();
  const { tier } = useTier();
  const queryClient = useQueryClient();
  const confirmBacklog = useConfirmUnsubscribeBacklog();
  const [archiveMove, setArchiveMove] = useState<ArchiveMove | null>(null);
  const hasActiveMailbox = me.activeMailboxId != null;
  useHomeArchiveUndo(me.activeMailboxId, archiveMove);

  const summary = useHomeSummary({ enabled: hasActiveMailbox });
  const sync = useSyncStatus(me.activeMailboxId ?? undefined, { enabled: hasActiveMailbox });
  const cleanup = useCleanupSummary();
  const mailboxId = me.activeMailboxId;
  const report = useQuery({
    ...homeInboxReportQueryOptions(mailboxId, async (signal) => {
      const envelope = await apiGet<InboxReportDto>(`/api/mailboxes/${mailboxId}/inbox-report`, {
        signal,
      });
      return envelope.data;
    }),
    enabled: hasActiveMailbox && mailboxId != null,
  });
  const later = useQuery({
    ...snoozedListQueryOptions((signal) => fetchSnoozed(signal)),
    select: (envelope) => envelope.data,
    enabled: hasActiveMailbox,
  });
  const presentation = homeReportPresentation(report.data);
  const laterStep = homeLaterCandidate(later.data ?? []);
  const nextSteps = rankHomeNextSteps(
    [...homeCandidatesFromReport(report.data ?? null), ...(laterStep !== null ? [laterStep] : [])],
    { senderSizeView: SENDER_SIZE_VIEW },
  );
  // The stage sentence comes from a client poll. The server document has
  // only the leave line, so the first client render must match that.
  const [stageMounted, setStageMounted] = useState(false);
  // A switch must not keep the previous report on screen. Hold the skeleton
  // until this mailbox's report arrives, including after the old cache entry
  // is removed. A first load has no other report cached, so a pending report
  // does not replace the summary page.
  const awaitingSwitchedReport = useRef(false);
  if (
    mailboxId != null &&
    report.isPending &&
    inboxReportCachedForOtherMailbox(queryClient, mailboxId)
  ) {
    awaitingSwitchedReport.current = true;
  }
  if (!report.isPending || mailboxId == null) awaitingSwitchedReport.current = false;
  useLayoutEffect(() => {
    setStageMounted(true);
  }, []);

  const activeMailbox = me.mailboxes.find((m) => m.id === me.activeMailboxId);
  const readiness = activeMailbox?.readiness;
  const syncing = readiness === 'queued' || readiness === 'syncing';

  function confirmHomeFix(step: HomeFixCandidate) {
    if (step.kind !== 'unsub_archive') return;
    const mailbox = activeMailbox?.id;
    if (!mailbox || step.senderIds.length === 0) return;
    confirmBacklog.mutate(
      { mailboxId: mailbox, mode: 'archive', senderIds: [...step.senderIds] },
      {
        onSuccess: (result) => {
          toastUnsubscribeBacklog(result);
          const next = celebrationFromUnsubscribeBacklog(result);
          if (next) {
            writeReportCelebration(mailbox, next);
            if (next.actionId && next.actionHandle) {
              setArchiveMove({ id: next.actionId, handle: next.actionHandle });
            }
          }
          void queryClient.invalidateQueries({ queryKey: activityKeys.all });
          void queryClient.invalidateQueries({ queryKey: undoKeys.all });
        },
        onError: toastUnsubscribeBacklogFailure,
      },
    );
  }

  // The active mailbox could not be resolved — the same takeover the app
  // chrome renders once `me` agrees.
  if (!hasActiveMailbox || isMailboxScopeConflict(summary.error)) return <NoActiveMailbox />;

  return (
    <HomeView
      state={resolve()}
      tier={tier}
      timeZone={me.user.timezone ?? 'UTC'}
      visitSummary={<HomeArrivals />}
      summary={cleanup.data ?? null}
      nextSteps={nextSteps}
      senderSizeView={SENDER_SIZE_VIEW}
      mailboxId={activeMailbox?.id ?? ''}
      reportLead={presentation.lead}
      supportText={presentation.support}
      onConfirmFix={(step) => confirmHomeFix(step)}
    />
  );

  function resolve(): HomeState {
    if (readiness === 'failed')
      return {
        kind: 'sync-failed',
        needsReconnect: activeMailbox?.needsReconnect === true,
        mailboxId: activeMailbox!.id,
      };
    if (summary.isError) {
      return { kind: 'error', error: summary.error, retry: () => void summary.refetch() };
    }
    if (summary.data === undefined || awaitingSwitchedReport.current) {
      return { kind: 'loading' };
    }

    const action = { label: 'Review senders', href: '/senders' };
    const numbers = composeHomeNumbers(summary.data);
    if (numbers === null) {
      // A failed scan is not a healthy empty mailbox — never "Nothing cleared yet".
      const stageSentence =
        stageMounted && readiness === 'syncing'
          ? (inProgressStageSentence(sync.data) ?? undefined)
          : undefined;
      return {
        kind: 'empty',
        syncing,
        queued: readiness === 'queued',
        ...(stageSentence !== undefined ? { stageSentence } : {}),
        action,
      };
    }
    return {
      kind: 'ready',
      ...numbers,
      since: summary.data.since,
      action,
    };
  }
}

function inboxReportCachedForOtherMailbox(queryClient: QueryClient, mailboxId: string): boolean {
  return (
    queryClient.getQueryCache().findAll({
      predicate: (query) => {
        const key = query.queryKey;
        return (
          key.at(-2) === 'inbox-report' &&
          key.at(-1) !== mailboxId &&
          query.state.data !== undefined
        );
      },
    }).length > 0
  );
}

/** Lead and support from the same insight the Inbox Report puts first. */
function homeReportPresentation(report: InboxReportDto | undefined): {
  lead: string | null;
  support: string | null;
} {
  if (report === undefined || report.variant !== 'full') return { lead: null, support: null };
  const insight = report.insights[0];
  if (insight === undefined) return { lead: null, support: null };
  return {
    lead: reportHeadline(insight).sentence,
    support: reportSupport(insight),
  };
}
