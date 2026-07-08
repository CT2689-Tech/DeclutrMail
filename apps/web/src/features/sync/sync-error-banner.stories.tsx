// Storybook CSF3 stories for the SyncErrorBanner (D224 passive
// incremental-sync failure surface; D210/D211 hidden + visible states).
//
// The banner reads `useSyncStatus` (seeded via the query cache) and
// `useSyncNow` (needs AuthProvider for the workspace's active mailbox)
// — stories seed both directly, mirroring the upgrade-modal story's
// local-shim pattern.

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { tokens } from '@declutrmail/shared';
import type { SyncStatus } from '@declutrmail/shared/contracts';

import { AuthProvider } from '@/features/auth/auth-provider';
import { ME_QUERY_KEY, type Me } from '@/features/auth/api/use-me';
import { SYNC_STATUS_KEY } from '@/features/onboarding/api/use-sync-status';

import { SyncErrorBanner } from './sync-error-banner';

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

const ME: Me = {
  user: { id: 'u-1', email: 'me@example.com', workspaceId: 'w-1' },
  activeMailboxId: 'mb-1',
  mailboxes: [
    {
      id: 'mb-1',
      email: 'me@example.com',
      status: 'active',
      connectedAt: null,
      readiness: 'ready',
    },
  ],
  tier: 'pro',
  cleanupRemaining: null,
};

/** ISO stamp `n` minutes before now — the 60-min window is relative. */
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
  client.setQueryData([...SYNC_STATUS_KEY, null], status);
  return (
    <div style={{ background: color.bg, minHeight: 200 }}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <SyncErrorBanner />
        </AuthProvider>
      </QueryClientProvider>
      <p
        style={{ fontFamily: font.sans, fontSize: 12, color: color.fgMuted, padding: '12px 20px' }}
      >
        {note}
      </p>
    </div>
  );
}

const meta: StoryMeta<typeof SyncErrorBanner> = {
  title: 'Sync/SyncErrorBanner',
  component: SyncErrorBanner,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Passive incremental-sync failure banner (D224). Shows when the most recent sync ' +
          'outcome is an error stamped within the last 60 minutes; a newer successful run ' +
          'clears it immediately. "Try again" reuses the Sync-now mutation.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Visible — a fresh incremental failure, newer than the last success. */
export const Visible: Story<typeof SyncErrorBanner> = {
  render: () =>
    frame(
      statusOf({
        last_synced_at: minutesAgo(30),
        last_sync_error_at: minutesAgo(5),
        last_sync_error_code: 'GMAIL_HISTORY_GONE',
      }),
      'Error stamped 5 minutes ago, last success 30 minutes ago — the banner surfaces.',
    ),
};

/** Hidden — a successful run after the failure clears the banner. */
export const HiddenAfterRecovery: Story<typeof SyncErrorBanner> = {
  render: () =>
    frame(
      statusOf({
        last_synced_at: minutesAgo(2),
        last_sync_error_at: minutesAgo(5),
        last_sync_error_code: 'GMAIL_HISTORY_GONE',
      }),
      'Success (2 minutes ago) is newer than the error (5 minutes ago) — nothing renders.',
    ),
};

/** Hidden — the error aged past the 60-minute window. */
export const HiddenWhenStale: Story<typeof SyncErrorBanner> = {
  render: () =>
    frame(
      statusOf({
        last_synced_at: null,
        last_sync_error_at: minutesAgo(90),
        last_sync_error_code: 'GMAIL_HISTORY_GONE',
      }),
      'Error stamped 90 minutes ago — outside the 60-minute window, nothing renders.',
    ),
};
