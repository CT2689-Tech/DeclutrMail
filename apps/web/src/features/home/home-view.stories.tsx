// Storybook CSF3 stories for Home (D210, D211).
//
// Uses the same lightweight CSF shims as the other web stories so it
// typechecks without `@storybook/react` installed. The presentational
// `HomeView` is storied (props only) — no AuthProvider, no QueryClient.
//
// Variants (D211 edge-state coverage):
//   • Cleared        — emails cleared hero + the three secondary numerals
//   • SendersDecided — nothing cleared yet, senders-decided hero
//   • NewUser        — no decisions: title + button
//   • Syncing        — no decisions, mailbox still being read
//   • SyncFailed     — no decisions, the mailbox's scan failed
//   • Loading / LoadError

import { HomeView } from './home-view';

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

const reviewSenders = { label: 'Review senders', href: '/senders' };

export const Cleared: Story<typeof HomeView> = {
  args: {
    state: {
      kind: 'ready',
      hero: { label: 'emails cleared', value: 12480 },
      since: '2026-03-15T12:00:00.000Z',
      secondary: [
        { label: 'Emails archived', value: 11932 },
        { label: 'Emails deleted', value: 548 },
        { label: 'Senders decided', value: 86 },
      ],
      action: { label: 'Review 8 today', href: '/triage' },
      pending: { triagePending: 8, screenerPending: 3 },
      senders: [
        { id: 'journal', name: 'The Sunday Journal', domain: 'journal.example', recentCount: 28 },
        { id: 'studio', name: 'Studio Notes', domain: 'studio.example', recentCount: 16 },
        { id: 'dispatch', name: 'Design Dispatch', domain: 'dispatch.example', recentCount: 42 },
      ],
    },
  },
};

export const SendersDecided: Story<typeof HomeView> = {
  args: {
    state: {
      kind: 'ready',
      hero: { label: 'senders decided', value: 3 },
      since: '2026-09-02T12:00:00.000Z',
      secondary: [],
      action: { label: 'Review 4 new', href: '/screener' },
    },
  },
};

export const NewUser: Story<typeof HomeView> = {
  args: { state: { kind: 'empty', syncing: false, action: reviewSenders } },
};

export const Syncing: Story<typeof HomeView> = {
  args: { state: { kind: 'empty', syncing: true, action: reviewSenders } },
};

export const SyncFailed: Story<typeof HomeView> = {
  args: { state: { kind: 'sync-failed' } },
};

export const Loading: Story<typeof HomeView> = {
  args: { state: { kind: 'loading' } },
};

export const LoadError: Story<typeof HomeView> = {
  args: { state: { kind: 'error', error: new Error('offline'), retry: () => {} } },
};
