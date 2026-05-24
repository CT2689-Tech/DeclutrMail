// Storybook CSF3 stories for the persistent undo tray (D35, D58).
//
// Mirrors the local-shim pattern used by `privacy-badge.stories.tsx`
// so it typechecks before the PR-3 Storybook seed lands (D210). Swap
// the shims for `@storybook/react` imports when the seed merges; the
// story shapes do not change.

import type { ComponentProps, ReactElement, ReactNode } from 'react';

import { color } from '../../tokens/tokens';
import { UndoTray } from './undo-tray';
import type { UndoTrayDataSource, UndoTrayEntry } from './undo-tray.types';

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

const meta: StoryMeta<typeof UndoTray> = {
  title: 'Undo/UndoTray',
  component: UndoTray,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Persistent undo tray (D35) — the post-action feedback channel. Each row maps to one undo_journal entry; "Undo" calls POST /api/undo/:token. Verbs are K/A/U/L (D227) plus "Rule applied" for Autopilot reverts.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type TrayArgs = ComponentProps<typeof UndoTray>;

const ISO_NOW = '2026-05-23T14:35:00Z';
const SEVEN_DAYS_OUT = '2026-05-30T14:35:00Z';

function staticSource(entries: UndoTrayEntry[]): UndoTrayDataSource {
  return {
    entries,
    isLoading: false,
    revert: async () => {
      /* no-op for stories */
    },
  };
}

function frame(child: ReactNode): ReactElement {
  return (
    <div
      style={{
        position: 'relative',
        background: color.bg,
        minHeight: 200,
        padding: 24,
      }}
    >
      {child}
    </div>
  );
}

/** Single archive action — the most common case post-Triage. */
export const SingleAction: Story<typeof UndoTray> = {
  render: (args: TrayArgs) =>
    frame(
      <UndoTray
        {...args}
        dataSource={staticSource([
          {
            token: '11111111-1111-1111-1111-111111111111',
            actionKind: 'archive',
            createdAt: ISO_NOW,
            expiresAt: SEVEN_DAYS_OUT,
          },
        ])}
      />,
    ),
  args: {
    mailboxAccountId: '00000000-0000-0000-0000-000000000000',
  },
};

/** Multiple decisions queued — the "3 decisions applied" D35 case. */
export const ThreeDecisions: Story<typeof UndoTray> = {
  render: (args: TrayArgs) =>
    frame(
      <UndoTray
        {...args}
        dataSource={staticSource([
          {
            token: '22222222-2222-2222-2222-222222222222',
            actionKind: 'archive',
            createdAt: ISO_NOW,
            expiresAt: SEVEN_DAYS_OUT,
          },
          {
            token: '33333333-3333-3333-3333-333333333333',
            actionKind: 'unsubscribe',
            createdAt: ISO_NOW,
            expiresAt: SEVEN_DAYS_OUT,
          },
          {
            token: '44444444-4444-4444-4444-444444444444',
            actionKind: 'later',
            createdAt: ISO_NOW,
            expiresAt: SEVEN_DAYS_OUT,
          },
        ])}
        onViewActivity={() => {
          /* host-app route */
        }}
      />,
    ),
  args: {
    mailboxAccountId: '00000000-0000-0000-0000-000000000000',
  },
};

/** Autopilot rule application — D99 / "Rule applied" label. */
export const RuleApplied: Story<typeof UndoTray> = {
  render: (args: TrayArgs) =>
    frame(
      <UndoTray
        {...args}
        dataSource={staticSource([
          {
            token: '55555555-5555-5555-5555-555555555555',
            actionKind: 'apply-rule',
            createdAt: ISO_NOW,
            expiresAt: SEVEN_DAYS_OUT,
          },
        ])}
      />,
    ),
  args: {
    mailboxAccountId: '00000000-0000-0000-0000-000000000000',
  },
};

/** Loading state — initial fetch before the API responds. */
export const Loading: Story<typeof UndoTray> = {
  render: (args: TrayArgs) =>
    frame(
      <UndoTray
        {...args}
        dataSource={{
          entries: [],
          isLoading: true,
          revert: async () => {
            /* no-op */
          },
        }}
      />,
    ),
  args: {
    mailboxAccountId: '00000000-0000-0000-0000-000000000000',
  },
};

/** Empty — no active tokens; the tray renders nothing (correct UX). */
export const Empty: Story<typeof UndoTray> = {
  render: (args: TrayArgs) =>
    frame(
      <div>
        <p
          style={{
            fontFamily: 'system-ui',
            fontSize: 13,
            color: color.fgMuted,
            margin: 0,
          }}
        >
          When there are no active tokens, the tray renders nothing (D35 — collapses into the
          Activity link in the empty state).
        </p>
        <UndoTray {...args} dataSource={staticSource([])} />
      </div>,
    ),
  args: {
    mailboxAccountId: '00000000-0000-0000-0000-000000000000',
  },
};

/**
 * Error — TanStack reported a failed fetch and no tokens are cached.
 * The tray renders a distinct red-bordered chip with a link back to
 * the Activity log (D211 — error states must not silently empty).
 */
export const ErrorState: Story<typeof UndoTray> = {
  render: (args: TrayArgs) =>
    frame(
      <UndoTray
        {...args}
        dataSource={{
          entries: [],
          isLoading: false,
          isError: true,
          error: new globalThis.Error('undo_fetch_failed:503'),
          revert: async () => {
            /* no-op */
          },
        }}
        onViewActivity={() => {
          /* host-app route */
        }}
      />,
    ),
  args: {
    mailboxAccountId: '00000000-0000-0000-0000-000000000000',
  },
};
