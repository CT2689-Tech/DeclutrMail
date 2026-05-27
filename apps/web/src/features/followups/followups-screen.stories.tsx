// Storybook CSF3 stories for the FollowupsScreen (D90, D91, D210).
//
// The screen reads from `useFollowups` (TanStack Query). We mount a
// QueryClient with prefilled cache state per story so each variant
// renders deterministically without an MSW round-trip — same pattern
// as the other feature screen stories in this codebase will use once
// the Storybook seed lands.
//
// Mirrors the local-shim pattern used by sibling stories so the file
// typechecks before the PR-3 Storybook seed merges (D210). Swap the
// shims for `@storybook/react` imports once the seed merges; the
// story shapes do not change.

import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { tokens } from '@declutrmail/shared';

import type { FollowupRow } from '@/lib/api/followups';

import { followupsKeys } from './api/query-keys';
import { FollowupsScreen } from './followups-screen';

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

function isoDaysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

const FIXTURES: FollowupRow[] = [
  {
    id: 'h1',
    providerThreadId: 'thread-h1',
    recipientEmail: 'boss@example.com',
    recipientDisplayName: 'Big Boss',
    subject: 'Q4 plans — please review when you get a chance',
    sentAt: isoDaysAgo(10),
    priority: 'high',
    status: 'awaiting',
    dismissedAt: null,
    createdAt: isoDaysAgo(10),
    updatedAt: isoDaysAgo(10),
  },
  {
    id: 'h2',
    providerThreadId: 'thread-h2',
    recipientEmail: 'finance@vendor.io',
    recipientDisplayName: 'Vendor Finance',
    subject: 'Invoice #4471 — terms question',
    sentAt: isoDaysAgo(9),
    priority: 'high',
    status: 'awaiting',
    dismissedAt: null,
    createdAt: isoDaysAgo(9),
    updatedAt: isoDaysAgo(9),
  },
  {
    id: 'm1',
    providerThreadId: 'thread-m1',
    recipientEmail: 'pm@startup.co',
    recipientDisplayName: 'Startup PM',
    subject: 'Re: Tuesday sync prep',
    sentAt: isoDaysAgo(4),
    priority: 'medium',
    status: 'awaiting',
    dismissedAt: null,
    createdAt: isoDaysAgo(4),
    updatedAt: isoDaysAgo(4),
  },
  {
    id: 'l1',
    providerThreadId: 'thread-l1',
    recipientEmail: 'peer@example.com',
    recipientDisplayName: 'Peer',
    subject: 'Lunch?',
    sentAt: isoDaysAgo(2),
    priority: 'low',
    status: 'awaiting',
    dismissedAt: null,
    createdAt: isoDaysAgo(2),
    updatedAt: isoDaysAgo(2),
  },
];

function makeClient(rows: FollowupRow[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  client.setQueryData(followupsKeys.list(), { data: rows });
  return client;
}

function frame(client: QueryClient) {
  return (
    <div style={{ background: tokens.color.bg, minHeight: 480, padding: 12 }}>
      <QueryClientProvider client={client}>
        <FollowupsScreen />
      </QueryClientProvider>
    </div>
  );
}

const meta: StoryMeta<typeof FollowupsScreen> = {
  title: 'Features/Followups/FollowupsScreen',
  component: FollowupsScreen,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Followups screen (D90, D91). Lists threads where you sent the last message and the recipient has not replied. Sorted oldest first per D85. Empty state copy is from D91 verbatim.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Populated — high + medium + low priority groups render together. */
export const Populated: Story<typeof FollowupsScreen> = {
  render: (_args: ComponentProps<typeof FollowupsScreen>) => frame(makeClient(FIXTURES)),
};

/** Empty — D91 verbatim copy renders inside the shared EmptyState. */
export const Empty: Story<typeof FollowupsScreen> = {
  render: (_args: ComponentProps<typeof FollowupsScreen>) => frame(makeClient([])),
};

/** All high-priority — every awaiting thread is over a week old. */
export const AllOverdue: Story<typeof FollowupsScreen> = {
  render: (_args: ComponentProps<typeof FollowupsScreen>) =>
    frame(makeClient(FIXTURES.filter((r) => r.priority === 'high'))),
};
