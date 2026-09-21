// Storybook CSF3 stories for the onboarding sync gate (D6, D109, D224).
//
// Storybook is seeded in PR 3 (D210). Until that lands this file uses
// the same lightweight CSF shims as `triage-screen.stories.tsx` so it
// typechecks without `@storybook/react` installed. Swap the shims for
// the real imports when the seed lands; the story shapes don't change.
//
// Variants (D210 + D211/D212 edge-state coverage):
//   • Queued   — sync just enqueued, 0%
//   • Syncing  — mid-scan, progress bar + active stage
//   • Ready    — all stages complete (the route auto-advances here)
//   • Failed   — terminal error with a known error_code
//   • FailedReconnect / FailedInsufficientScopes — Reconnect only
//   • FailedQuota / FailedQuotaPartlyReady — rate_limit Try again /
//     Finish sync | Continue ready
//   • Stuck    — stale heartbeat while still queued/syncing

import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tokens } from '@declutrmail/shared';
import { STALE_INITIAL_SYNC_MS, type SyncStatus } from '@declutrmail/shared/contracts';
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
          'Onboarding sync gate (D109). "Reading your inbox…" — the strict gate (D6) shown after a Gmail connect. Progress bar + 6-stage indicator are driven by real backend state (no fake ticking). The shared PrivacyBadge and explicit storage list are always present.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type GateArgs = ComponentProps<typeof SyncGate>;

function frame(children: React.ReactNode) {
  // Failed / stuck variants mount TanStack hooks (retry, logout,
  // disconnect). A fresh QueryClient per story keeps those mutations
  // off the network; progress-only variants don't need it but sharing
  // one wrapper is cheaper than a second frame helper.
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <div style={{ background: color.bg, minHeight: '100vh' }}>{children}</div>
    </QueryClientProvider>
  );
}

const QUEUED: SyncStatus = {
  readiness_status: 'queued',
  current_stage: 'queued',
  progress_pct: 0,
  is_ready_for_triage: false,
};

const SYNCING: SyncStatus = {
  readiness_status: 'syncing',
  current_stage: 'building_sender_index',
  progress_pct: 45,
  is_ready_for_triage: false,
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
  args: { status: QUEUED },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/** Syncing — mid-scan with the active stage highlighted. */
export const Syncing: Story<typeof SyncGate> = {
  args: { status: SYNCING },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/** Ready — every stage complete (the route auto-advances to /triage). */
export const Ready: Story<typeof SyncGate> = {
  args: { status: READY },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/** Failed — terminal error with retry affordance. */
export const Failed: Story<typeof SyncGate> = {
  args: { status: FAILED },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/** Failed — invalid_grant: Reconnect only, never Retry. */
export const FailedReconnect: Story<typeof SyncGate> = {
  args: {
    status: { ...FAILED, error_code: 'InvalidGrantError' },
    mailboxId: 'mb-1',
  },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/** Failed — insufficient_scopes (ProviderPermissionError alias): Reconnect only. */
export const FailedInsufficientScopes: Story<typeof SyncGate> = {
  args: {
    status: { ...FAILED, error_code: 'ProviderPermissionError' },
    mailboxId: 'mb-1',
  },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/** Failed — rate_limit with no progress: Try again (quota-resume). */
export const FailedQuota: Story<typeof SyncGate> = {
  args: {
    status: { ...FAILED, error_code: 'GmailQuotaError', progress_pct: 0 },
    mailboxId: 'mb-1',
  },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/**
 * Failed — rate_limit with progress already moved: Finish sync | Continue
 * ready. Continue is a wiring hook; production first-run does not pass
 * it (D6 still requires a completed initial scan).
 */
export const FailedQuotaPartlyReady: Story<typeof SyncGate> = {
  args: {
    status: { ...FAILED, error_code: 'GmailQuotaError', progress_pct: 32 },
    mailboxId: 'mb-1',
    onContinuePartial: () => {},
  },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

const STUCK_NOW = Date.parse('2026-09-21T12:00:00.000Z');

/**
 * Stuck — still `syncing` but the worker heartbeat is older than the
 * shared age gate. Same recovery chrome as failed, with Retry.
 */
export const Stuck: Story<typeof SyncGate> = {
  args: {
    status: {
      ...SYNCING,
      updated_at: new Date(STUCK_NOW - STALE_INITIAL_SYNC_MS - 1_000).toISOString(),
    },
    mailboxId: 'mb-1',
    nowMs: STUCK_NOW,
  },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/**
 * Syncing (secondary connect, D116) — same gate, plus the escape hatch:
 * "Stay here" keeps waiting; "Go back to <primary>" switches the active
 * mailbox back and leaves. Only renders when another active mailbox
 * exists; first-run has no escape (strict gate, D6).
 */
export const SyncingSecondary: Story<typeof SyncGate> = {
  args: {
    status: SYNCING,
    escape: { returnToEmail: 'primary@example.com', onReturn: () => {} },
  },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};

/**
 * Failed (secondary connect, D116) — a failed scan on a second mailbox
 * offers "Go back to <primary>" alongside the recovery button so the
 * user is never stranded on a failed gate with a working primary inbox.
 */
export const FailedSecondary: Story<typeof SyncGate> = {
  args: {
    status: FAILED,
    escape: { returnToEmail: 'primary@example.com', onReturn: () => {} },
  },
  render: (args: GateArgs) => frame(<SyncGate {...args} />),
};
