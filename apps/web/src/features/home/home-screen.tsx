'use client';

import { useAuth } from '@/features/auth/auth-provider';
import { useTier } from '@/features/auth/api/use-tier';
import { isMailboxScopeConflict } from '@/features/mailboxes/api/reset-mailbox-cache';
import { NoActiveMailbox } from '@/features/mailboxes/no-active-mailbox';

import { useHomePending } from './api/use-home-pending';
import { useHomeSummary } from './api/use-home-summary';
import { useHomeWorkflows } from './api/use-home-workflows';
import { composeHomeAction, composeHomeNumbers, type HomeState } from './home-state';
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
 * | no decisions, still syncing   | "Reading your Gmail" + button    |
 * | no decisions, scan failed     | "Gmail scan failed" + Settings   |
 * | no decisions                  | "Nothing cleared yet" + button   |
 * | decisions                     | number + label + button          |
 *
 * A mailbox switch needs nothing here: `resetMailboxScopedCache`
 * invalidates every query, these included.
 */
export function HomeScreen() {
  const { me } = useAuth();
  const { tier } = useTier();
  const hasActiveMailbox = me.activeMailboxId != null;

  const summary = useHomeSummary({ enabled: hasActiveMailbox });
  const pending = useHomePending({ tier, enabled: hasActiveMailbox });
  const workflows = useHomeWorkflows(tier, hasActiveMailbox);

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
      workflows={workflows}
      timeZone={me.user.timezone ?? 'UTC'}
    />
  );

  function resolve(): HomeState {
    if (summary.isError) {
      return { kind: 'error', error: summary.error, retry: () => void summary.refetch() };
    }
    // Totals can render independently. Keep the action non-interactive
    // until its destination/count is known, so a link never moves under the cursor.
    if (summary.data === undefined) return { kind: 'loading' };

    const action = pending.isLoading
      ? { label: 'Loading review tasks…', href: '/senders', loading: true }
      : composeHomeAction(pending);
    const numbers = composeHomeNumbers(summary.data);
    if (numbers === null) {
      // A failed scan is not a healthy empty mailbox — never "Nothing cleared yet".
      if (readiness === 'failed') {
        return { kind: 'sync-failed', needsReconnect: activeMailbox?.needsReconnect === true };
      }
      return { kind: 'empty', syncing, action, senders: pending.senders };
    }
    return {
      kind: 'ready',
      ...numbers,
      since: summary.data.since,
      action,
      pending,
      senders: pending.senders,
    };
  }
}
