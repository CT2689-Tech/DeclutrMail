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
  noisePreventedPerMonth: null,
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
    // D57 — Autopilot rows carry the rule that fired.
    rule: { id: '22222222-2222-2222-2222-222222222222', name: 'Newsletter graveyard' },
    feedbackRating: 'expected',
    undoState: {
      kind: 'available',
      token: '11111111-1111-1111-1111-111111111111',
      expiresAt: new Date(NOW + 6 * 24 * 60 * 60 * 1000).toISOString(),
    },
    executionState: null,
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
    rule: null,
    feedbackRating: null,
    undoState: { kind: 'unavailable' },
    executionState: null,
  },
  {
    // D56 — the confirmed OUTCOME for the r-2 click: the brand's RFC 8058
    // endpoint accepted the unsubscribe ~1h later. Renders as its own row
    // ("Unsubscribe confirmed"), distinct from the intent above.
    id: 'r-2b',
    occurredAt: isoHoursAgo(7),
    source: 'manual',
    action: 'unsubscribe_confirmed',
    affectedCount: 0,
    sender: {
      senderKey: 'sk-shop',
      displayName: 'Old Navy',
      email: 'mail@oldnavy.example',
      domain: 'oldnavy.example',
    },
    rule: null,
    feedbackRating: null,
    undoState: { kind: 'unavailable' },
    executionState: null,
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
    rule: null,
    feedbackRating: null,
    undoState: { kind: 'unavailable' },
    executionState: null,
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
    // Deleted-rule fallback — renders plain "by Autopilot".
    rule: null,
    feedbackRating: null,
    undoState: { kind: 'executed', executedAt: isoHoursAgo(70) },
    executionState: null,
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
    rule: null,
    feedbackRating: null,
    undoState: {
      kind: 'expired',
      expiredAt: new Date(NOW - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    executionState: null,
  },
];

function makeClient(
  rows: ActivityRowWire[] | undefined,
  window: ActivityWindowWire,
  source: ActivitySourceFilterWire,
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number } = {
    nextCursor: null,
    hasMore: false,
    limit: 25,
  },
): QueryClient {
  const client = new QueryClient({
    // `retryOnMount: false` keeps the NextPageError story stable — an
    // errored query would otherwise refetch on mount, hit the absent
    // API in the Storybook canvas, and overwrite the seeded fetchMeta.
    defaultOptions: {
      queries: { retry: false, retryOnMount: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
  if (rows) {
    // U27 — `useActivity` is an infinite query; the cache entry is
    // InfiniteData ({ pages, pageParams }), one page per envelope.
    client.setQueryData(activityKeys.list({ window, source }), {
      pages: [
        {
          data: rows,
          meta: {
            pagination,
            stats: STATS,
            allTimeStats: STATS,
            window,
            source,
            verbs: [],
            senderQuery: '',
            dateFrom: null,
            dateTo: null,
          },
        },
      ],
      pageParams: [undefined],
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

/**
 * Mobile (< sm) — the 7-column desktop row grid restacks into cards and
 * the 5-tile metrics strip collapses to 3-per-row. Driven by
 * `useIsAtMost('sm')` reading the resized story viewport's matchMedia.
 */
export const Mobile: Story<typeof ActivityScreen> = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: (_args: ComponentProps<typeof ActivityScreen>) => frame(makeClient(ROWS, '30d', 'all')),
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

// ── U27 — D57 LoadMoreRegion states (D210) ───────────────────────────

/**
 * Has-next — `nextCursor` set on the loaded page, so the tail region
 * renders the "Load more" button (plus the IntersectionObserver
 * sentinel; with no API in the canvas an auto-fired load settles into
 * the partial-error state below).
 */
export const LoadMoreAvailable: Story<typeof ActivityScreen> = {
  render: (_args: ComponentProps<typeof ActivityScreen>) =>
    frame(
      makeClient(ROWS, '30d', 'all', { nextCursor: 'cursor-page-2', hasMore: true, limit: 25 }),
    ),
};

/** End of list — `nextCursor: null` → quiet mono marker with the loaded count. */
export const EndOfList: Story<typeof ActivityScreen> = {
  render: (_args: ComponentProps<typeof ActivityScreen>) =>
    frame(makeClient(ROWS.slice(0, 2), '30d', 'all')),
};

/**
 * Partial-error (D211) — page 1 loaded, fetchNextPage failed. The rows
 * stay on screen and the tail region renders the amber inline retry.
 * The error state is not part of the cached `InfiniteData`, so the
 * story seeds it on the Query directly: status 'error' + fetchMeta
 * direction 'forward' is exactly what a rejected `fetchNextPage`
 * leaves behind (and what `isFetchNextPageError` derives from).
 */
export const NextPageError: Story<typeof ActivityScreen> = {
  render: (_args: ComponentProps<typeof ActivityScreen>) => {
    const client = makeClient(ROWS.slice(0, 2), '30d', 'all', {
      nextCursor: 'cursor-page-2',
      hasMore: true,
      limit: 25,
    });
    const query = client
      .getQueryCache()
      .find({ queryKey: activityKeys.list({ window: '30d', source: 'all' }) });
    query?.setState({
      status: 'error',
      error: new Error('HTTP 500 — next page failed'),
      fetchStatus: 'idle',
      fetchMeta: { fetchMore: { direction: 'forward' } },
    });
    return frame(client);
  },
};
