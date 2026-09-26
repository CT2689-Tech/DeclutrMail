// Storybook CSF3 stories for the onboarding sync gate (D6, D109, D224).
//
// Storybook is seeded in PR 3 (D210). Until that lands this file uses
// the same lightweight CSF shims as `triage-screen.stories.tsx` so it
// typechecks without `@storybook/react` installed. Swap the shims for
// the real imports when the seed lands; the story shapes don't change.
//
// Variants (D210 + D211/D212 edge-state coverage):
//   • Queued               — sync just enqueued, 0%
//   • Syncing              — mid-scan; the "we'll email you" leave line
//   • SyncingReadyEmailOff — mid-scan; leave line without the email promise
//   • RescanNoReadyEmail   — re-scan of a mailbox that finished before; no email promise
//   • ReadingBeforeTotal   — reading, mailbox not listed yet: the stage sentence
//   • ReadingListed        — listed, first batch not in: "Found 40,898 emails"
//   • ReadingCount         — reading: "12,400 of 40,898 emails", no time yet
//   • ReadingTimeLeft      — live batches; time left appears after the second
//   • ReadingLongestLine   — live, 7-digit total and the hour form (wrap check)
//   • Ready                — scan done, shown until the route navigates away
//   • Failed               — terminal error with a known error_code
//   • FailedPermanent      — the longest failed copy; names the support address
//   • SyncingSecondary / FailedSecondary — second mailbox, with "Go back

import { useEffect, useState, type ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';
import type { SyncStatus } from '@declutrmail/shared/contracts';
import { SyncGate } from './sync-gate';

const { color } = tokens;

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

const meta: StoryMeta<typeof SyncGate> = {
  title: 'Onboarding/SyncGate',
  component: SyncGate,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Onboarding sync gate (D109). "Reading your inbox…" — the strict gate (D6) shown after a Gmail connect. One line saying the user may leave (it promises the "Your inbox is ready" email only when that email will go: switched on, and the first scan of that mailbox), one progress bar and one line under it, all from real backend state: while the scan reads the mailbox, emails read of emails in it (plus time left once the tab has watched two batches arrive); otherwise the stage sentence. No privacy badge on this screen — it sits on the promise step, at the decision point.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type GateArgs = ComponentProps<typeof SyncGate>;

function frame(children: React.ReactNode) {
  return <div style={{ background: color.bg, minHeight: '100vh' }}>{children}</div>;
}

// `last_synced_at: null` — a first scan, the only kind the ready email
// goes for.
const QUEUED: SyncStatus = {
  readiness_status: 'queued',
  current_stage: 'queued',
  progress_pct: 0,
  is_ready_for_triage: false,
  last_synced_at: null,
};

const SYNCING: SyncStatus = {
  readiness_status: 'syncing',
  current_stage: 'building_sender_index',
  progress_pct: 45,
  is_ready_for_triage: false,
  last_synced_at: null,
};

const READY: SyncStatus = {
  readiness_status: 'ready',
  current_stage: 'ready',
  progress_pct: 100,
  is_ready_for_triage: true,
};

const FAILED: SyncStatus = {
  readiness_status: 'failed',
  current_stage: 'failed',
  progress_pct: 32,
  is_ready_for_triage: false,
  error_code: 'RateLimitError',
};

/** Queued — scan enqueued, progress at 0. */
export const Queued: Story<typeof SyncGate> = {
  args: { status: QUEUED, readyEmail: true },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/**
 * Syncing — mid-scan. The user has the "Your inbox is ready" email on, so
 * the line under the title says they may leave and will get it (D109).
 */
export const Syncing: Story<typeof SyncGate> = {
  args: { status: SYNCING, readyEmail: true },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/** Syncing, ready email switched off — the leave line makes no email promise. */
export const SyncingReadyEmailOff: Story<typeof SyncGate> = {
  args: { status: SYNCING, readyEmail: false },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/**
 * Re-scan of a mailbox that finished before (a retry after a failed
 * re-scan, a reconnect) — no ready email goes, so none is promised even
 * with the setting on.
 */
export const RescanNoReadyEmail: Story<typeof SyncGate> = {
  args: {
    status: { ...SYNCING, last_synced_at: '2026-09-01T10:00:00.000Z' },
    readyEmail: true,
  },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

const READING: SyncStatus = {
  readiness_status: 'syncing',
  current_stage: 'fetching_metadata',
  progress_pct: 26,
  is_ready_for_triage: false,
  last_synced_at: null,
  message_progress: { processed: 12_400, total: 40_898, age_ms: 0 },
};

/** Reading, before the mailbox is listed — no total yet, so no count. */
export const ReadingBeforeTotal: Story<typeof SyncGate> = {
  args: { status: { ...READING, progress_pct: 5, message_progress: null }, readyEmail: true },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/** Listed, first batch not in yet — what the listing found, not a zero. */
export const ReadingListed: Story<typeof SyncGate> = {
  args: {
    status: {
      ...READING,
      progress_pct: 5,
      message_progress: { processed: 0, total: 40_898, age_ms: 0 },
    },
    readyEmail: true,
  },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/**
 * Reading — emails read of emails in the mailbox, from the worker's
 * batches. No time left yet: counts on screen at first render are not
 * timed.
 */
export const ReadingCount: Story<typeof SyncGate> = {
  args: { status: READING, readyEmail: true },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/**
 * Feeds a 500-email batch every 2s from the story's own counts, the way
 * the poll sees the worker's, and starts over at the end so the story
 * never runs dry.
 */
function LiveReading(args: GateArgs) {
  const start = args.status.message_progress ?? { processed: 12_400, total: 40_898, age_ms: 0 };
  const [processed, setProcessed] = useState(start.processed);
  useEffect(() => {
    const id = setInterval(
      () => setProcessed((p) => (p + 500 >= start.total ? start.processed : p + 500)),
      2_000,
    );
    return () => clearInterval(id);
  }, [start.processed, start.total]);
  return (
    <SyncGate
      {...args}
      status={{
        ...args.status,
        progress_pct: 5 + Math.round((70 * processed) / start.total),
        message_progress: { processed, total: start.total, age_ms: 0 },
      }}
    />
  );
}

/**
 * Reading, live — "about N min left" joins the count once a second batch
 * lands, at the rate between them.
 */
export const ReadingTimeLeft: Story<typeof SyncGate> = {
  args: { status: READING, readyEmail: true },
  render: (args: GateArgs) => frame(<LiveReading {...args} />),
};

/**
 * The longest realistic line — a 7-digit mailbox in the hour form. At
 * phone width it may break only after the dot.
 */
export const ReadingLongestLine: Story<typeof SyncGate> = {
  args: {
    status: {
      ...READING,
      message_progress: { processed: 12_345, total: 1_234_567, age_ms: 0 },
    },
    readyEmail: true,
  },
  render: (args: GateArgs) => frame(<LiveReading {...args} />),
};

/** Ready — shown only until the route navigates to the next step. */
export const Ready: Story<typeof SyncGate> = {
  args: { status: READY, readyEmail: true },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/** Failed — terminal error with retry affordance. */
export const Failed: Story<typeof SyncGate> = {
  args: { status: FAILED },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/**
 * Failed on a permanent error — the longest failed copy. It names
 * support@declutrmail.com because the first-run gate has no route to Help.
 */
export const FailedPermanent: Story<typeof SyncGate> = {
  args: { status: { ...FAILED, error_code: 'PermanentError' } },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/**
 * Syncing (secondary connect, D116) — same gate, plus the escape hatch:
 * "Go back to <primary>" switches the active
 * mailbox back and leaves. Only renders when another active mailbox
 * exists; first-run has no escape (strict gate, D6).
 */
export const SyncingSecondary: Story<typeof SyncGate> = {
  args: {
    status: SYNCING,
    readyEmail: true,
    escape: { returnToEmail: 'primary@example.com', onReturn: () => {} },
  },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/**
 * Failed (secondary connect, D116) — a failed scan on a second mailbox
 * offers "Go back to <primary>" alongside "Try again" so the user is
 * never stranded on a failed gate with a working primary inbox.
 */
export const FailedSecondary: Story<typeof SyncGate> = {
  args: {
    status: FAILED,
    escape: { returnToEmail: 'primary@example.com', onReturn: () => {} },
  },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};
