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
  toastUnsubscribeBacklog,
  toastUnsubscribeBacklogFailure,
} from '@/features/inbox-report/backlog-outcome';
import { isMailboxScopeConflict } from '@/features/mailboxes/api/reset-mailbox-cache';
import { NoActiveMailbox } from '@/features/mailboxes/no-active-mailbox';
import { undoKeys } from '@/features/undo/query-keys';

import { useCleanupSummary } from '@/features/billing/use-cleanup-summary';
import { useSyncStatus } from '@/features/onboarding/api/use-sync-status';
import { hasCapability } from '@declutrmail/shared/entitlements';
import { syncStatusNeedsReconnect } from '@/features/mailboxes/mailbox-health';
import { useNow } from '@/lib/use-now';
import { inProgressStageSentence } from '@/features/onboarding/sync-stage-copy';
import { apiGet } from '@/lib/api/client';
import { useConfirmUnsubscribeBacklog } from '@/lib/api/use-action';

import { homeInboxReportQueryOptions } from './api/query-options';
import { useHomeSenderPreview } from './api/use-home-sender-preview';
import { useHomeSummary } from './api/use-home-summary';
import { useHomeCleanupStatus } from './api/use-home-cleanup-status';
import { useHomeAttention } from './api/use-home-attention';
import { homePriority, homeSyncLine } from './home-orientation';
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
 * | decisions                     | next action + closed Details     |
 *
 * A mailbox switch needs nothing here: `resetMailboxScopedCache`
 * invalidates every query, these included.
 */
/** F2's size field is not on main, so the Largest card stays off. */
const SENDER_SIZE_VIEW = false;

export function HomeScreen() {
  const { me } = useAuth();
  const { tier } = useTier();
  const queryClient = useQueryClient();
  const confirmBacklog = useConfirmUnsubscribeBacklog();
  const hasActiveMailbox = me.activeMailboxId != null;

  const summary = useHomeSummary({
    enabled: hasActiveMailbox,
    mailboxId: me.activeMailboxId ?? undefined,
  });
  const sync = useSyncStatus(me.activeMailboxId ?? undefined, { enabled: hasActiveMailbox });
  const cleanup = useCleanupSummary();
  const mailboxId = me.activeMailboxId;
  const activeMailbox = me.mailboxes.find((m) => m.id === mailboxId);
  const cleanupStatus = useHomeCleanupStatus(mailboxId);
  const canReviewNew =
    hasActiveMailbox && hasCapability(tier, 'screener') && activeMailbox?.readiness === 'ready';
  const { newSenders, later } = useHomeAttention(mailboxId, canReviewNew);
  const needsReconnect =
    activeMailbox?.needsReconnect === true || syncStatusNeedsReconnect(sync.data);
  const now = useNow(60_000, sync.data?.last_synced_at);
  const scope = useRef({ mailboxId, generation: 0 });
  if (scope.current.mailboxId !== mailboxId)
    scope.current = { mailboxId, generation: scope.current.generation + 1 };
  const report = useQuery({
    ...homeInboxReportQueryOptions(mailboxId, async (signal) => {
      const envelope = await apiGet<InboxReportDto>(`/api/mailboxes/${mailboxId}/inbox-report`, {
        signal,
      });
      return envelope.data;
    }),
    enabled: hasActiveMailbox && mailboxId != null,
  });
  const presentation = homeReportPresentation(report.data);
  const laterStep = homeLaterCandidate(later.isError ? [] : (later.data ?? []), now);
  const priority = homePriority({
    sync: sync.isError ? undefined : sync.data,
    needsReconnect,
    cleanup: cleanupStatus,
    newSenders: !canReviewNew || newSenders.isError ? null : (newSenders.data?.pending ?? null),
    laterAttention: later.isError
      ? 0
      : (later.data ?? []).filter(
          (row) => row.returnStatus === 'missed' || row.returnStatus === 'retrying',
        ).length,
  });
  const nextSteps = rankHomeNextSteps(
    [...homeCandidatesFromReport(report.data ?? null), ...(laterStep !== null ? [laterStep] : [])],
    { senderSizeView: SENDER_SIZE_VIEW },
  );
  const senderPreview = useHomeSenderPreview(
    mailboxId,
    nextSteps.find((step) => step.kind === 'unsub_archive')?.senderIds ?? [],
    activeMailbox?.readiness === 'ready' && summary.data !== undefined && !summary.isError,
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

  const readiness =
    stageMounted && !sync.isError
      ? (sync.data?.readiness_status ?? activeMailbox?.readiness)
      : activeMailbox?.readiness;
  const syncing = readiness === 'queued' || readiness === 'syncing';

  function confirmHomeFix(step: HomeFixCandidate) {
    if (step.kind !== 'unsub_archive') return;
    const mailbox = activeMailbox?.id;
    if (!mailbox || step.senderIds.length === 0) return;
    if (confirmBacklog.isPending) return;
    const generation = scope.current.generation;
    confirmBacklog.mutate(
      { mailboxId: mailbox, mode: 'archive', senderIds: [...step.senderIds] },
      {
        onSuccess: (result) => {
          if (scope.current.generation === generation) toastUnsubscribeBacklog(result);
          void queryClient.invalidateQueries({ queryKey: activityKeys.all });
          void queryClient.invalidateQueries({ queryKey: undoKeys.all });
        },
        onError: (error) => {
          if (scope.current.generation === generation) toastUnsubscribeBacklogFailure(error);
        },
      },
    );
  }

  // The active mailbox could not be resolved — the same takeover the app
  // chrome renders once `me` agrees.
  if (!hasActiveMailbox || isMailboxScopeConflict(summary.error)) return <NoActiveMailbox />;

  return (
    <HomeView
      key={mailboxId}
      state={resolve()}
      statusLine={
        stageMounted
          ? homeSyncLine(sync.data, sync.isError, needsReconnect, now)
          : 'Checking Gmail status…'
      }
      priority={stageMounted ? priority : null}
      noSuggestions={report.isSuccess && nextSteps.length === 0}
      tier={tier}
      visitSummary={<HomeArrivals />}
      summary={cleanup.data ?? null}
      nextSteps={nextSteps.map((step) =>
        step.kind === 'unsub_archive' ? { ...step, senders: senderPreview } : step,
      )}
      senderSizeView={SENDER_SIZE_VIEW}
      mailboxId={activeMailbox?.id ?? ''}
      mailboxEmail={activeMailbox?.email ?? null}
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
