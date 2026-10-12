'use client';

import { useLayoutEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  reportHeadline,
  reportSupport,
  type InboxReportDto,
} from '@declutrmail/shared/inbox-report';

import { useAuth } from '@/features/auth/auth-provider';
import { useTier } from '@/features/auth/api/use-tier';
import { isMailboxScopeConflict } from '@/features/mailboxes/api/reset-mailbox-cache';
import { NoActiveMailbox } from '@/features/mailboxes/no-active-mailbox';

import { useCleanupSummary } from '@/features/billing/use-cleanup-summary';
import { useSyncStatus } from '@/features/onboarding/api/use-sync-status';
import { inProgressStageSentence } from '@/features/onboarding/sync-stage-copy';
import { apiGet } from '@/lib/api/client';
import { fetchSnoozed } from '@/lib/api/snoozed';
import { snoozedListQueryOptions } from '@/features/snoozed/api/query-options';

import { homeInboxReportQueryOptions } from './api/query-options';
import { useHomeSummary } from './api/use-home-summary';
import { HomeArrivals } from './home-arrivals';
import { homeCandidatesFromReport, homeLaterCandidate, rankHomeNextSteps } from './home-next-steps';
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

export function HomeScreen() {
  const { me } = useAuth();
  const { tier } = useTier();
  const hasActiveMailbox = me.activeMailboxId != null;

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
    staleTime: 30_000,
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
  useLayoutEffect(() => {
    setStageMounted(true);
  }, []);

  const activeMailbox = me.mailboxes.find((m) => m.id === me.activeMailboxId);
  const readiness = activeMailbox?.readiness;
  const syncing = readiness === 'queued' || readiness === 'syncing';

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
    // Totals can render independently. Keep the action non-interactive
    // until its destination/count is known, so a link never moves under the cursor.
    if (summary.data === undefined) return { kind: 'loading' };

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
