'use client';

import { useAuth } from '@/features/auth/auth-provider';
import { useTier } from '@/features/auth/api/use-tier';
import { isMailboxScopeConflict } from '@/features/mailboxes/api/reset-mailbox-cache';
import { NoActiveMailbox } from '@/features/mailboxes/no-active-mailbox';

import { useHomePending } from './api/use-home-pending';
import { useHomeSummary } from './api/use-home-summary';
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
 * | no decisions, still syncing   | "Reading your inbox" + button    |
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

  const readiness = me.mailboxes.find((m) => m.id === me.activeMailboxId)?.readiness;
  const syncing = readiness === 'queued' || readiness === 'syncing';

  // The active mailbox could not be resolved — the same takeover the app
  // chrome renders once `me` agrees.
  if (!hasActiveMailbox || isMailboxScopeConflict(summary.error)) return <NoActiveMailbox />;

  return <HomeView state={resolve()} />;

  function resolve(): HomeState {
    if (summary.isError) {
      return { kind: 'error', error: summary.error, retry: () => void summary.refetch() };
    }
    // Wait for the button's count too, so its label never changes under
    // the user's cursor a moment after first paint.
    if (summary.data === undefined || pending.isLoading) return { kind: 'loading' };

    const action = composeHomeAction(pending);
    const numbers = composeHomeNumbers(summary.data);
    if (numbers === null) {
      // A failed scan is not a healthy empty mailbox — never "Nothing cleared yet".
      if (readiness === 'failed') return { kind: 'sync-failed' };
      return { kind: 'empty', syncing, action };
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
