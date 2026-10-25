// Storybook CSF3 stories for Home (D210, D211).
//
// Uses the same lightweight CSF shims as the other web stories so it
// typechecks without `@storybook/react` installed. The presentational
// `HomeView` is storied (props only) — no AuthProvider, no QueryClient.
//
// Variants: full, fallback, empty, sync-failed, no-F2, loading, error.

import { HomeView } from './home-view';
import { overviewFixture, reportFixture } from './home-view.fixture';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
};

const meta: StoryMeta<typeof HomeView> = {
  title: 'Home/HomeView',
  component: HomeView,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
};

export default meta;

const action = { label: 'Review senders', href: '/senders' };

const ready = {
  kind: 'ready' as const,
  hero: { label: 'emails cleared', value: 3310 },
  since: '2026-08-11T12:00:00.000Z',
  secondary: [
    { label: 'Emails archived', value: 3000 },
    { label: 'Emails deleted', value: 310 },
    { label: 'Senders decided', value: 41 },
  ],
  action,
};

const summary = {
  metered: true,
  limit: 1000,
  used: 360,
  remaining: 640,
  resetAt: '2026-11-01T00:00:00.000Z',
};

const steps = [
  {
    kind: 'unsub_archive' as const,
    senderCount: 3,
    emailCount: 2400,
    senderIds: ['a', 'b', 'c'],
    senders: [
      {
        inboxCount: 900,
        readRate: 0.02,
        id: 'a',
        name: 'Fresh Finds Weekly',
        domain: 'freshfinds.synthetic.test',
      },
      {
        inboxCount: 800,
        readRate: 0.02,
        id: 'b',
        name: 'Meadow Lane Dispatch',
        domain: 'meadow.synthetic.test',
      },
      {
        inboxCount: 700,
        readRate: 0.02,
        id: 'c',
        name: 'North Letter',
        domain: 'north.synthetic.test',
      },
    ],
  },
  { kind: 'largest' as const, senderCount: 10, sizeLabel: '2.1 GB', senderIds: ['b'] },
  { kind: 'later_due' as const, senderCount: 3, senderIds: ['c'] },
];

/** Details starts closed; expand it to inspect history and report facts. */
export const Full: Story<typeof HomeView> = {
  args: {
    state: ready,
    overview: overviewFixture,
    report: reportFixture,
    newSenders: { status: 'ready', data: 12 },
    later: { status: 'ready', data: { due: 3, troubled: 0, nextAt: null } },
    tier: 'pro',
    summary,
    nextSteps: steps,
    senderSizeView: true,
    reportSizeLabel: '7.7 GB',
  },
};

export const NoSizeView: Story<typeof HomeView> = {
  args: {
    state: ready,
    overview: overviewFixture,
    report: reportFixture,
    newSenders: { status: 'ready', data: 12 },
    later: { status: 'ready', data: { due: 3, troubled: 0, nextAt: null } },
    tier: 'pro',
    summary,
    nextSteps: steps,
    senderSizeView: false,
    reportSizeLabel: '7.7 GB',
  },
};

export const CaughtUp: Story<typeof HomeView> = {
  args: {
    state: ready,
    summary,
    nextSteps: [],
    indexedEmailCount: 47,
  },
};

export const NewUser: Story<typeof HomeView> = {
  args: { state: { kind: 'empty', syncing: false, action } },
};

export const FirstCleanup: Story<typeof HomeView> = {
  args: {
    state: { kind: 'empty', syncing: false, action },
    nextSteps: [steps[0]!],
  },
};

export const UnknownImpact: Story<typeof HomeView> = {
  args: {
    state: ready,
    nextSteps: [
      {
        kind: 'unsub_archive',
        senderCount: 5,
        senderIds: ['a', 'b', 'c'],
        senders: [
          {
            inboxCount: 900,
            readRate: 0.02,
            id: 'a',
            name: 'Fresh Finds Weekly',
            domain: 'freshfinds.synthetic.test',
          },
          {
            inboxCount: 800,
            readRate: 0.02,
            id: 'b',
            name: 'Meadow Lane Dispatch',
            domain: 'meadow.synthetic.test',
          },
          {
            inboxCount: 700,
            readRate: 0.02,
            id: 'c',
            name: 'North Letter',
            domain: 'north.synthetic.test',
          },
        ],
      },
    ],
  },
};

export const Syncing: Story<typeof HomeView> = {
  args: { state: { kind: 'empty', syncing: true, action } },
};

export const QueuedScan: Story<typeof HomeView> = {
  args: { state: { kind: 'empty', syncing: true, queued: true, action } },
};

export const SyncFailed: Story<typeof HomeView> = {
  args: { state: { kind: 'sync-failed', needsReconnect: false } },
};

export const SyncFailedNeedsReconnect: Story<typeof HomeView> = {
  args: { state: { kind: 'sync-failed', needsReconnect: true } },
};

export const Loading: Story<typeof HomeView> = {
  args: { state: { kind: 'loading' } },
};

export const LoadError: Story<typeof HomeView> = {
  args: { state: { kind: 'error', error: new Error('offline'), retry: () => {} } },
};

export const LaterOnly: Story<typeof HomeView> = { args: { state: ready, nextSteps: [steps[2]!] } };

export const Returning: Story<typeof HomeView> = {
  args: {
    state: ready,
    nextSteps: steps,
    statusLine: 'Gmail connected · Last scanned 5m ago',
    visitSummary: <p>Since your last visit: 24 new emails scanned · 3 new senders</p>,
    priority: {
      title: '3 new senders need review.',
      action: { label: 'Review new senders', href: '/senders?view=first-review' },
    },
  },
};

export const CleanupRunning: Story<typeof HomeView> = {
  args: {
    state: ready,
    nextSteps: steps,
    statusLine: 'Gmail connected · Last scanned just now',
    priority: {
      title: 'Your cleanup is in progress.',
      action: { label: 'Open Activity', href: '/activity' },
    },
  },
};

export const NoSuggestions: Story<typeof HomeView> = {
  args: { state: ready, statusLine: 'Gmail connected · Last scanned 5m ago', noSuggestions: true },
};

export const ReconnectWhileReady: Story<typeof HomeView> = {
  args: {
    state: ready,
    nextSteps: steps,
    statusLine: 'Gmail needs reconnect',
    priority: {
      title: 'Reconnect Gmail to continue.',
      action: { label: 'Open Settings', href: '/settings#mailboxes' },
    },
  },
};
