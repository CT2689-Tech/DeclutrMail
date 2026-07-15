// Storybook CSF3 stories for the SnoozedScreen (D78–D80, D210, D211).
//
// The screen reads from `useSnoozed` (TanStack Query). We mount a
// QueryClient with prefilled cache state per story so each variant
// renders deterministically without an MSW round-trip — same pattern
// as `followups-screen.stories.tsx`.
//
// Mirrors the local-shim pattern used by sibling stories so the file
// typechecks before the PR-3 Storybook seed merges (D210).

import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { tokens } from '@declutrmail/shared';

import type { SnoozedSenderRow } from '@/lib/api/snoozed';

import { snoozedKeys } from './api/query-keys';
import { SnoozedScreen } from './snoozed-screen';

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

const NOW = Date.now();

function isoInHours(hours: number): string {
  return new Date(NOW + hours * 60 * 60 * 1000).toISOString();
}

const FIXTURES: SnoozedSenderRow[] = [
  {
    senderId: '6f1f2f3a-0000-4000-8000-000000000001',
    displayName: 'Daily Digest',
    email: 'digest@news.example.com',
    domain: 'news.example.com',
    laterCount: 12,
    snoozedUntil: isoInHours(3),
    snoozedAt: isoInHours(-24),
    reason: 'after launch week',
    returnStatus: 'scheduled',
    lastReturnAttemptAt: null,
    returnFailureKind: null,
  },
  {
    senderId: '6f1f2f3a-0000-4000-8000-000000000002',
    displayName: 'Deals & Offers',
    email: 'offers@shop.example.com',
    domain: 'shop.example.com',
    laterCount: 47,
    snoozedUntil: isoInHours(30),
    snoozedAt: isoInHours(-2),
    reason: null,
    returnStatus: 'scheduled',
    lastReturnAttemptAt: null,
    returnFailureKind: null,
  },
  {
    senderId: '6f1f2f3a-0000-4000-8000-000000000003',
    displayName: 'Conference Updates',
    email: 'updates@conf.example.com',
    domain: 'conf.example.com',
    laterCount: 5,
    snoozedUntil: isoInHours(24 * 5),
    snoozedAt: isoInHours(-48),
    reason: 'until the schedule is final',
    returnStatus: 'scheduled',
    lastReturnAttemptAt: null,
    returnFailureKind: null,
  },
  {
    senderId: '6f1f2f3a-0000-4000-8000-000000000004',
    displayName: 'Quarterly Newsletter',
    email: 'news@corp.example.com',
    domain: 'corp.example.com',
    laterCount: 3,
    snoozedUntil: isoInHours(24 * 30),
    snoozedAt: isoInHours(-1),
    reason: null,
    returnStatus: 'scheduled',
    lastReturnAttemptAt: null,
    returnFailureKind: null,
  },
];

function makeClient(rows?: SnoozedSenderRow[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  });
  if (rows) {
    client.setQueryData(snoozedKeys.list(), { data: rows });
  }
  return client;
}

function frame(client: QueryClient) {
  return (
    <div style={{ background: tokens.color.bg, minHeight: 480, padding: 12 }}>
      <QueryClientProvider client={client}>
        <SnoozedScreen />
      </QueryClientProvider>
    </div>
  );
}

const meta: StoryMeta<typeof SnoozedScreen> = {
  title: 'Features/Later/LaterScreen',
  component: SnoozedScreen,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Later screen (D78–D80, D245). Senders sent to Later, grouped by wake-time bucket, with Wake-now and scheduling presets.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Populated — every D80 wake bucket, each with a required return time. */
export const Populated: Story<typeof SnoozedScreen> = {
  render: (_args: ComponentProps<typeof SnoozedScreen>) => frame(makeClient(FIXTURES)),
};

/** Empty — nothing in Later; points the user at the Later verb. */
export const Empty: Story<typeof SnoozedScreen> = {
  render: (_args: ComponentProps<typeof SnoozedScreen>) => frame(makeClient([])),
};

/**
 * Mobile (≤sm, D60) — the 4-track row grid restacks to a single column
 * so identity · count · wake-status · actions each take a full-width row
 * without clipping on a phone.
 */
export const Mobile: Story<typeof SnoozedScreen> = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: (_args: ComponentProps<typeof SnoozedScreen>) => frame(makeClient(FIXTURES)),
};

/** Mirror degraded — counts unresolved (label mapping not published). */
export const CountSyncing: Story<typeof SnoozedScreen> = {
  render: (_args: ComponentProps<typeof SnoozedScreen>) =>
    frame(makeClient(FIXTURES.map((r) => ({ ...r, laterCount: null })))),
};

/** Loading — skeleton rows while the first fetch is in flight. */
export const Loading: Story<typeof SnoozedScreen> = {
  render: (_args: ComponentProps<typeof SnoozedScreen>) => {
    const client = makeClient();
    // A never-resolving prefetch pins the query in `pending`; the
    // mounted hook dedups onto it, so the skeleton renders forever.
    void client.prefetchQuery({
      queryKey: snoozedKeys.list(),
      queryFn: () => new Promise<never>(() => {}),
    });
    return frame(client);
  },
};

/** Error — full-surface failure with retry (D211 `error` state). */
export const ErrorState: Story<typeof SnoozedScreen> = {
  render: (_args: ComponentProps<typeof SnoozedScreen>) => {
    const client = makeClient();
    void client
      .prefetchQuery({
        queryKey: snoozedKeys.list(),
        queryFn: () => Promise.reject(new Error('boom')),
      })
      .catch(() => {});
    return frame(client);
  },
};
