// Storybook CSF3 stories for the Autopilot screen (D104, D105).
//
// Storybook itself is seeded in PR 3 (D210). Until the seed lands,
// this file uses the same lightweight local CSF shims as the Triage
// + Sender Detail stories. When the seed lands, swap the shims for
// the real `@storybook/react` imports; the story shapes do not change.
//
// Variants covered (per D211/D212 + Storybook contract):
//   • Default            — all five preset rules + grouped suggestions
//                          (rule #1's observe window elapsed → day-7 banner)
//   • Loading            — skeleton stacks (rules + suggestions)
//   • Error              — fetch failed branch
//   • Empty              — rules exist but no pending matches
//   • EmptyNoRules       — fresh mailbox, no rules seeded yet
//   • AllPaused          — D105 paused banner visible, Pause-all disabled
//   • PauseConfirmOpen   — D226 mandatory preview modal mid-flight
//   • ApproveConfirmOpen — D226 preview before the D104 approve mutation
//   • ActivateConfirmOpen— D226 preview before Observe → Active

import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tokens } from '@declutrmail/shared';
import {
  AUTO_ARCHIVE_LOW_ENGAGEMENT,
  PENDING_SUGGESTIONS,
  PRESET_RULES_ALL_FIVE,
  PRESET_RULES_ALL_PAUSED,
  PRESET_RULES_OBSERVE,
  RULE_PREVIEW_RESULT,
} from './fixtures';
import { ActivateRuleModal } from './activate-rule-modal';
import { ApproveConfirmModal } from './approve-confirm-modal';
import { AutopilotScreen } from './autopilot-screen';
import { AutopilotObservePreview } from './autopilot-entitlement-surface';
import { autopilotKeys } from './api/query-keys';
import { PauseConfirmModal } from './pause-confirm-modal';
import type { AutopilotScreenState } from './types';

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

const meta: StoryMeta<typeof AutopilotScreen> = {
  title: 'Autopilot/AutopilotScreen',
  component: AutopilotScreen,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Autopilot screen (D104, D105). Surfaces the Observe-mode pending suggestions buffer + a master pause-all button. Per D226 the pause confirmation renders a mandatory modal preview before the mutation runs. Per D227 the screen never surfaces "Screen" as a verb (the screen-new-senders preset emits Later, the canonical 4th verb). Custom rule builder UI is deferred to V2.1 per D196/D197 — only preset rules render.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type PageArgs = ComponentProps<typeof AutopilotScreen>;

/**
 * Stories own the QueryClient because the screen's mutation hooks call
 * `useMutation` even when the page renders fixture data. A throwaway
 * client per render keeps stories deterministic.
 */
function frame(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={client}>
      <div style={{ background: color.bg, minHeight: '100vh' }}>{children}</div>
    </QueryClientProvider>
  );
}

/** Default — all five preset rules, grouped suggestions, day-7 banner. */
export const Default: Story<typeof AutopilotScreen> = {
  args: {
    state: {
      kind: 'ready',
      rules: PRESET_RULES_ALL_FIVE,
      suggestions: PENDING_SUGGESTIONS.map((match) => ({
        match,
        rule: PRESET_RULES_ALL_FIVE.find((r) => r.id === match.ruleId) ?? null,
      })),
    } satisfies AutopilotScreenState,
  },
  render: (args: PageArgs) => frame(<AutopilotScreen {...args} />),
};

/** Loading — skeleton stack on first paint. */
export const Loading: Story<typeof AutopilotScreen> = {
  args: { state: { kind: 'loading' } },
  render: (args: PageArgs) => frame(<AutopilotScreen {...args} />),
};

/** Error — both queries failed; the retryable error state remains inside the route shell. */
export const Error: Story<typeof AutopilotScreen> = {
  args: {
    state: {
      kind: 'error',
      message: "We couldn't load Autopilot right now.",
      retry: () => undefined,
    },
  },
  render: (args: PageArgs) => frame(<AutopilotScreen {...args} />),
};

/** Rules exist but the matcher hasn't produced anything yet. */
export const Empty: Story<typeof AutopilotScreen> = {
  args: {
    state: {
      kind: 'ready',
      rules: PRESET_RULES_OBSERVE,
      suggestions: [],
    },
  },
  render: (args: PageArgs) => frame(<AutopilotScreen {...args} />),
};

/** Fresh mailbox — no rules seeded yet (pre-D101 seed in tests). */
export const EmptyNoRules: Story<typeof AutopilotScreen> = {
  args: {
    state: { kind: 'empty', rules: [] },
  },
  render: (args: PageArgs) => frame(<AutopilotScreen {...args} />),
};

/** D105 — every rule paused. The banner is visible and Pause-all is disabled. */
export const AllPaused: Story<typeof AutopilotScreen> = {
  args: {
    state: {
      kind: 'ready',
      rules: PRESET_RULES_ALL_PAUSED,
      suggestions: [],
    },
  },
  render: (args: PageArgs) => frame(<AutopilotScreen {...args} />),
};

/** Free/Plus — real installed preset catalog before the Pro Active-execution ask. */
export const PreUpgradeObservePreview: Story<typeof AutopilotObservePreview> = {
  render: () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(autopilotKeys.rules(), PRESET_RULES_ALL_FIVE);
    return (
      <QueryClientProvider client={client}>
        <div style={{ background: color.bg, minHeight: '100vh' }}>
          <AutopilotObservePreview />
        </div>
      </QueryClientProvider>
    );
  },
};

/**
 * D226 — pause-confirm modal in its mid-flight state. Renders the
 * modal directly (the screen is in the background for context).
 */
export const PauseConfirmOpen: Story<typeof PauseConfirmModal> = {
  render: () =>
    frame(
      <PauseConfirmModal
        open
        rules={PRESET_RULES_OBSERVE}
        onCancel={() => undefined}
        onConfirm={() => undefined}
        isPausing={false}
        pauseError={null}
      />,
    ),
};

/**
 * D226 — the D104 approve preview. Enumerates the exact senders the
 * approval covers + the verb-true consequence before the mutation.
 */
export const ApproveConfirmOpen: Story<typeof ApproveConfirmModal> = {
  render: () =>
    frame(
      <ApproveConfirmModal
        rule={AUTO_ARCHIVE_LOW_ENGAGEMENT}
        matches={PENDING_SUGGESTIONS.filter((m) => m.ruleId === AUTO_ARCHIVE_LOW_ENGAGEMENT.id)}
        kind="selected"
        pendingTotal={null}
        pendingApproximate={false}
        isApproving={false}
        error={null}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    ),
};

/**
 * D226 — "Approve all" when the pending buffer hit the BE's 50-row page
 * cap. The mutation is an UNCAPPED server-side update, so the preview
 * must state the real scope (~total) and qualify the chip list as "the
 * latest N" rather than presenting a page count as the total.
 */
export const ApproveAllBeyondBuffer: Story<typeof ApproveConfirmModal> = {
  render: () =>
    frame(
      <ApproveConfirmModal
        rule={AUTO_ARCHIVE_LOW_ENGAGEMENT}
        matches={PENDING_SUGGESTIONS.filter((m) => m.ruleId === AUTO_ARCHIVE_LOW_ENGAGEMENT.id)}
        kind="all"
        pendingTotal={214}
        pendingApproximate
        isApproving={false}
        error={null}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    ),
};

/**
 * D226 — the day-7 Observe → Active preview. States what changes
 * going forward, that already-collected suggestions stay pending, and
 * what the FIRST active sweep would do right now (dry-run resolved —
 * Confirm enabled). Loading/error gating variants live in the
 * ActivateRuleModal stories.
 */
export const ActivateConfirmOpen: Story<typeof ActivateRuleModal> = {
  render: () =>
    frame(
      <ActivateRuleModal
        rule={AUTO_ARCHIVE_LOW_ENGAGEMENT}
        pendingCount={2}
        pendingApproximate={false}
        preview={{ status: 'ready', result: RULE_PREVIEW_RESULT }}
        onRetryPreview={() => undefined}
        isActivating={false}
        error={null}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    ),
};
