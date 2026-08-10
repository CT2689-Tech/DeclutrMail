// Storybook CSF3 stories for the standing protected-senders review
// (Settings → Protected senders; D245 / CLAUDE.md §2.6).
//
// The claim these variants exist to pin: every row names the EXACT
// protection reason (three of the four are automatic — before #483 the
// list looked like a list of things the user had chosen), says what
// unread mail the protection is shielding, and offers Unprotect in
// place. The ordering sentence is only made when it is true of the
// loaded rows: every row measured, at least one non-zero.
//
// The screen FETCHES (`useSenders` infinite query), so stories pin the
// query via prefetch on the exact cache key — the mounted hook dedupes
// onto it and its own `queryFn` never runs (sibling pattern:
// `snoozed-screen.stories.tsx`).

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tokens } from '@declutrmail/shared';

import { sendersKeys } from '@/features/senders/api/query-keys';
import { SendersPoliciesScreen } from './senders-policies-screen';

const { color } = tokens;

const meta: Meta<typeof SendersPoliciesScreen> = {
  title: 'Settings/SendersPoliciesScreen',
  component: SendersPoliciesScreen,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The standing protection review — the post-onboarding home of the question the D245 onboarding review asks once. Exact reason per row, shielded unread mail, Unprotect in place.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof SendersPoliciesScreen>;

/** The exact key `SendersPoliciesScreen` queries with. */
const LIST_KEY = sendersKeys.list({
  category: undefined,
  limit: 50,
  isProtected: true,
  sort: undefined,
  direction: undefined,
  q: undefined,
  activity: undefined,
  activityNegate: undefined,
  unsubReady: undefined,
  replied: undefined,
  windowDays: undefined,
  domain: undefined,
  unsubIgnored: undefined,
});

function wireRow(over: {
  id: string;
  displayName: string;
  reason: 'user_defined' | 'replied' | 'starred' | 'gmail_important';
  unreadInboxCount?: number | null | undefined;
  inboxCount?: number | null | undefined;
  monthlyVolume?: number | null | undefined;
}) {
  return {
    id: over.id,
    displayName: over.displayName,
    email: `${over.id}@example.com`,
    domain: 'example.com',
    gmailCategory: 'updates' as const,
    lastSeenAt: '2026-08-01T00:00:00.000Z',
    firstSeenAt: '2025-01-01T00:00:00.000Z',
    monthlyVolume: over.monthlyVolume === undefined ? 12 : over.monthlyVolume,
    readRate: 0.1,
    volumeTrend: 'steady' as const,
    unsubscribeMethod: null,
    lastReview: null,
    protectionFlags: {
      isProtected: true,
      protectionReason: over.reason,
      protectionSetAt: '2026-04-01T00:00:00.000Z',
    },
    inboxCount: over.inboxCount,
    unreadInboxCount: over.unreadInboxCount,
  };
}

function page(
  rows: ReturnType<typeof wireRow>[],
  opts: { totalMatching?: number; nextCursor?: string | null } = {},
) {
  return {
    data: rows,
    meta: {
      pagination: {
        nextCursor: opts.nextCursor ?? null,
        hasMore: (opts.nextCursor ?? null) !== null,
        limit: 50,
      },
      query: {
        totalMatching: opts.totalMatching ?? rows.length,
        globalMaxTotal: opts.totalMatching ?? rows.length,
        asOf: '2026-08-10T00:00:00.000Z',
      },
    },
  };
}

function pinnedClient(): QueryClient {
  return new QueryClient({
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
}

function seeded(pages: ReturnType<typeof page>[]): QueryClient {
  const client = pinnedClient();
  client.setQueryData(LIST_KEY, {
    pages,
    pageParams: pages.map((_, i) => (i === 0 ? undefined : `cursor-${i}`)),
  });
  return client;
}

function frame(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <div style={{ background: color.bg, minHeight: 640 }}>
        <SendersPoliciesScreen />
      </div>
    </QueryClientProvider>
  );
}

/**
 * The working list: one row per reason, ordered by shielded unread
 * mail, the ordering claim true (every row measured, one non-zero).
 */
export const ProtectedList: Story = {
  render: () =>
    frame(
      seeded([
        page([
          wireRow({
            id: 'god-of-prompt',
            displayName: 'Robert from God of Prompt',
            reason: 'starred',
            unreadInboxCount: 145,
            inboxCount: 166,
          }),
          wireRow({
            id: 'getyourguide',
            displayName: 'GetYourGuide',
            reason: 'gmail_important',
            unreadInboxCount: 33,
            inboxCount: 34,
          }),
          wireRow({
            id: 'accountant',
            displayName: 'Meera (Accounts)',
            reason: 'replied',
            unreadInboxCount: 2,
            inboxCount: 9,
          }),
          wireRow({
            id: 'bank',
            displayName: 'First National Bank',
            reason: 'user_defined',
            unreadInboxCount: 0,
            inboxCount: 3,
          }),
        ]),
      ]),
    ),
};

/**
 * A row the server never measured sorts LAST — after the known zero —
 * and the ordering sentence is suppressed: unknown is not zero, and no
 * arrangement of unmeasured rows is "most shielded first".
 */
export const UnmeasuredRowSuppressesOrderingClaim: Story = {
  render: () =>
    frame(
      seeded([
        page([
          wireRow({
            id: 'measured',
            displayName: 'Measured Sender',
            reason: 'starred',
            unreadInboxCount: 5,
            inboxCount: 8,
          }),
          wireRow({
            id: 'zero',
            displayName: 'Known Zero',
            reason: 'gmail_important',
            unreadInboxCount: 0,
            inboxCount: 0,
          }),
          wireRow({
            id: 'unmeasured',
            displayName: 'Unmeasured (older API)',
            reason: 'starred',
            unreadInboxCount: undefined,
            inboxCount: undefined,
            monthlyVolume: null,
          }),
        ]),
      ]),
    ),
};

/** More rows on the server than loaded — the Show-more footer renders. */
export const MorePagesAvailable: Story = {
  render: () =>
    frame(
      seeded([
        page(
          [
            wireRow({
              id: 'first-of-many',
              displayName: 'First Of Many',
              reason: 'starred',
              unreadInboxCount: 41,
              inboxCount: 44,
            }),
          ],
          { totalMatching: 55, nextCursor: 'page-2' },
        ),
      ]),
    ),
};

/** Nothing protected — level-1 empty state, not an error. */
export const Empty: Story = {
  render: () => frame(seeded([page([], { totalMatching: 0 })])),
};

/** First fetch in flight. */
export const Loading: Story = {
  render: () => {
    const client = pinnedClient();
    void client.prefetchQuery({
      queryKey: LIST_KEY,
      queryFn: () => new Promise<never>(() => {}),
    });
    return frame(client);
  },
};

/**
 * First fetch failed with nothing retained — the ONE case the
 * whole-screen error owns. A failed background refetch or "Show more"
 * with rows on screen must NOT land here (the gate is
 * `isError && data == null`); the footer owns the next-page failure.
 */
export const LoadFailed: Story = {
  render: () => {
    const client = pinnedClient();
    void client
      .prefetchQuery({
        queryKey: LIST_KEY,
        queryFn: () => Promise.reject(new Error('boom')),
      })
      .catch(() => {});
    return frame(client);
  },
};
