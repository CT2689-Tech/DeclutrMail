// Storybook CSF3 stories for SyncNowButton (D210/D211 — the failed-state
// indicator's states were shipping with no visual review artifact,
// design-system-agent gate finding on the sync QA branch).
//
// Same local-shim pattern as sync-error-banner.stories.tsx: the button
// reads `useSyncStatus` (seeded via the query cache) and `useSyncNow` /
// `useRetryInitialSync` (need AuthProvider for the workspace's active
// mailbox), so stories seed both directly rather than mounting a real
// AuthProvider network fetch.

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { tokens } from '@declutrmail/shared';
import type { SyncStatus } from '@declutrmail/shared/contracts';

import { AuthProvider } from '@/features/auth/auth-provider';
import { ME_QUERY_KEY, type Me } from '@/features/auth/api/use-me';
import { syncStatusQueryKey } from '@/features/onboarding/api/use-sync-status';

import { SyncNowButton } from './sync-now-button';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

const { color, font } = tokens;

const MAILBOX_ID = 'mb-1';

const ME: Me = {
  user: { id: 'u-1', email: 'me@example.com', workspaceId: 'w-1', timezone: null },
  activeMailboxId: MAILBOX_ID,
  mailboxes: [
    {
      id: MAILBOX_ID,
      email: 'me@example.com',
      status: 'active',
      connectedAt: null,
      readiness: 'ready',
    },
  ],
  tier: 'pro',
  cleanupRemaining: null,
};

/** ISO stamp `n` minutes before now. */
function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

function statusOf(overrides: Partial<SyncStatus>): SyncStatus {
  return {
    readiness_status: 'ready',
    current_stage: 'ready',
    progress_pct: 100,
    is_ready_for_triage: true,
    last_synced_at: null,
    last_sync_error_at: null,
    last_sync_error_code: null,
    ...overrides,
  };
}

function frame(status: SyncStatus, note: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ME_QUERY_KEY, ME);
  client.setQueryData(syncStatusQueryKey(MAILBOX_ID), status);
  return (
    <div style={{ background: color.bg, minHeight: 80, padding: 20 }}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <SyncNowButton mailboxId={MAILBOX_ID} />
        </AuthProvider>
      </QueryClientProvider>
      <p style={{ fontFamily: font.sans, fontSize: 12, color: color.fgMuted, padding: '12px 0 0' }}>
        {note}
      </p>
    </div>
  );
}

const meta: StoryMeta<typeof SyncNowButton> = {
  title: 'Sync/SyncNowButton',
  component: SyncNowButton,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "The app-shell header's manual sync trigger. Hidden while an initial sync is " +
          'queued/syncing (the onboarding gate owns that state) or while a live incremental ' +
          'auth error routes to the persistent reconnect banner instead. Renders a failed-scan ' +
          "indicator (QA-sync-20260831-03) for readiness='failed' — the only chrome surface an " +
          'already-onboarded user sees for that state, since the onboarding gate never renders ' +
          'for them again.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Idle — ready and not in flight. */
export const Idle: Story<typeof SyncNowButton> = {
  render: () =>
    frame(
      statusOf({ last_synced_at: minutesAgo(12) }),
      'Ready, synced 12 minutes ago — the ordinary "Sync now" control.',
    ),
};

/** Hidden — an initial sync is still in progress; the onboarding gate owns this state. */
export const HiddenWhileSyncing: Story<typeof SyncNowButton> = {
  render: () =>
    frame(
      statusOf({ readiness_status: 'syncing', current_stage: 'building_sender_index' }),
      "queued/syncing renders nothing — the onboarding gate is this state's chrome.",
    ),
};

/** Failed, retryable — offers "Scan again" against the same worker. */
export const FailedRetryable: Story<typeof SyncNowButton> = {
  render: () =>
    frame(
      statusOf({
        readiness_status: 'failed',
        current_stage: 'failed',
        last_sync_error_code: 'RateLimitError',
      }),
      'Terminal initial-sync failure, non-auth cause — "Scan again" re-queues the same mailbox.',
    ),
};

/** Failed, needs reauth — offers "Reconnect Gmail" instead of a doomed retry. */
export const FailedNeedsReconnect: Story<typeof SyncNowButton> = {
  render: () =>
    frame(
      statusOf({
        readiness_status: 'failed',
        current_stage: 'failed',
        error_code: 'InvalidGrantError',
      }),
      'Terminal failure with a revoked/expired grant — routes to OAuth, never a doomed retry.',
    ),
};

/** Hidden — a live incremental auth error routes to the persistent reconnect banner instead. */
export const HiddenNeedsReconnectIncremental: Story<typeof SyncNowButton> = {
  render: () =>
    frame(
      statusOf({
        last_synced_at: minutesAgo(180),
        last_sync_error_at: minutesAgo(5),
        last_sync_error_code: 'InvalidGrantError',
      }),
      'A live incremental auth error renders nothing here — MailboxReconnectBanner owns it.',
    ),
};
