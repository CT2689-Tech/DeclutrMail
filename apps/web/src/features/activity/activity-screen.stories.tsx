// Storybook CSF3 stories for the ActivityScreen (D55-D60, D210).
//
// The screen reads from `useActivity` (TanStack Query). Stories
// prefill the cache so each variant renders deterministically. Same
// local-shim pattern as the followups + brief stories until the
// PR-3 Storybook seed merges.

import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { tokens } from '@declutrmail/shared';

import type {
  ActivityRowWire,
  ActivitySourceFilterWire,
  ActivityStatsWire,
  ActivityWindowWire,
} from '@/lib/api/activity';

import { activityKeys } from './api/query-keys';
import { ActivityScreen } from './activity-screen';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  parameters?: Record<string, unknown>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

const NOW = new Date('2026-05-25T08:00:00Z').getTime();

function isoHoursAgo(h: number): string {
  return new Date(NOW - h * 60 * 60 * 1000).toISOString();
}

const STATS: ActivityStatsWire = {
  archived: 47,
  unsubscribed: 12,
  kept: 8,
  later: 3,

  deleted: 0,
  followupsDismissed: 2,
  needsAttention: 0,
};

const ROWS: ActivityRowWire[] = [
  {
    id: 'r-1',
    occurredAt: isoHoursAgo(2),
    source: 'autopilot',
    action: 'archive',
    affectedCount: 12,
    sender: {
      senderKey: 'sk-news',
      displayName: 'Newsletter Daily',
      email: 'news@daily.example',
      domain: 'daily.example',
    },
    undoState: {
      kind: 'available',
      token: '11111111-1111-1111-1111-111111111111',
      expiresAt: new Date(NOW + 6 * 24 * 60 * 60 * 1000).toISOString(),
    },
  },
  {
    id: 'r-2',
    occurredAt: isoHoursAgo(8),
    source: 'manual',
    action: 'unsubscribe',
    affectedCount: 1,
    sender: {
      senderKey: 'sk-shop',
      displayName: 'Old Navy',
      email: 'mail@oldnavy.example',
      domain: 'oldnavy.example',
    },
    undoState: { kind: 'unavailable' },
  },
  {
    id: 'r-3',
    occurredAt: isoHoursAgo(36),
    source: 'triage',
    action: 'keep',
    affectedCount: 0,
    sender: {
      senderKey: 'sk-boss',
      displayName: 'Big Boss',
      email: 'boss@example.com',
      domain: 'example.com',
    },
    undoState: { kind: 'unavailable' },
  },
  {
    id: 'r-4',
    occurredAt: isoHoursAgo(72),
    source: 'autopilot',
    action: 'archive',
    affectedCount: 7,
    sender: {
      senderKey: 'sk-vendor',
      displayName: 'Vendor Co',
      email: 'billing@vendor.example',
      domain: 'vendor.example',
    },
    undoState: { kind: 'executed', executedAt: isoHoursAgo(70) },
  },
  {
    id: 'r-5',
    occurredAt: new Date(NOW - 12 * 24 * 60 * 60 * 1000).toISOString(),
    source: 'manual',
    action: 'archive',
    affectedCount: 3,
    sender: {
      senderKey: 'sk-old',
      displayName: 'Older Sender',
      email: 'old@example.com',
      domain: 'example.com',
    },
    undoState: {
      kind: 'expired',
      expiredAt: new Date(NOW - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
  },
];

function makeClient(
  rows: ActivityRowWire[] | undefined,
  window: ActivityWindowWire,
  source: ActivitySourceFilterWire,
): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  if (rows) {
    client.setQueryData(activityKeys.list(window, source), {
      data: rows,
      meta: {
        pagination: { nextCursor: null, hasMore: false, limit: 25 },
        stats: STATS,
        window,
        source,
      },
    });
  }
  return client;
}

function frame(client: QueryClient) {
  return (
    <div style={{ background: tokens.color.bg, minHeight: 600, padding: 12 }}>
      <QueryClientProvider client={client}>
        <ActivityScreen />
      </QueryClientProvider>
    </div>
  );
}

const meta: StoryMeta<typeof ActivityScreen> = {
  title: 'Features/Activity/ActivityScreen',
  component: ActivityScreen,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Activity feed (D55-D60). Stats header (D59), source chips (D56 partial), window picker (D55), and row list with D58 undo affordances rendered from the pre-resolved undoState discriminator.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Populated — mix of undo states + sources. */
export const Populated: Story<typeof ActivityScreen> = {
  render: (_args: ComponentProps<typeof ActivityScreen>) => frame(makeClient(ROWS, '30d', 'all')),
};

/** Empty — D212 empty state with widen-window suggestion. */
export const Empty: Story<typeof ActivityScreen> = {
  render: (_args: ComponentProps<typeof ActivityScreen>) => frame(makeClient([], '7d', 'all')),
};

/** Source-filtered (Autopilot only). */
export const AutopilotOnly: Story<typeof ActivityScreen> = {
  render: (_args: ComponentProps<typeof ActivityScreen>) =>
    frame(
      makeClient(
        ROWS.filter((r) => r.source === 'autopilot'),
        '30d',
        'autopilot',
      ),
    ),
};
