'use client';

import { useAuth } from '@/features/auth/auth-provider';
import { useTier } from '@/features/auth/api/use-tier';
import { isMailboxScopeConflict } from '@/features/mailboxes/api/reset-mailbox-cache';
import { NoActiveMailbox } from '@/features/mailboxes/no-active-mailbox';

import { useCleanupSummary } from '@/features/billing/use-cleanup-summary';
import { getFixSet } from '@/features/inbox-report';

import { useSyncStatus } from '@/features/onboarding/api/use-sync-status';
import { inProgressStageSentence } from '@/features/onboarding/sync-stage-copy';

import { useHomeSummary } from './api/use-home-summary';
import { HomeArrivals } from './home-arrivals';
import { rankHomeNextSteps } from './home-next-steps';
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
 * | no decisions, scan failed     | "Gmail scan failed" + Settings   |
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
  const nextSteps = rankHomeNextSteps(getFixSet(), { senderSizeView: SENDER_SIZE_VIEW });

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
        readiness === 'syncing' ? (inProgressStageSentence(sync.data) ?? undefined) : undefined;
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
