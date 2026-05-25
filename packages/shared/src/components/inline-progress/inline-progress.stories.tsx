// Storybook CSF3 stories for InlineProgress (D166 — inline action
// progress for button-level loading). Mirrors the local-shim CSF
// types used elsewhere in this package; swap for `@storybook/react`
// imports when the PR-3 Storybook seed lands (D210).

import type { ComponentProps, ReactNode } from 'react';

import { color, font, radius } from '../../tokens/tokens';
import { InlineProgress } from './inline-progress';

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

const meta: StoryMeta<typeof InlineProgress> = {
  title: 'Loading/InlineProgress',
  component: InlineProgress,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'D166 inline action progress. The `inline` mode (default) overlays a spinner on top of the button label so the host control keeps its measured width — no layout shift while the action is in flight. The `trailing` mode places the spinner after the label for row-level or status-pill progress.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type Args = ComponentProps<typeof InlineProgress>;

function FakeButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        height: 32,
        padding: '0 14px',
        background: color.primary,
        color: '#FFFFFF',
        border: `1px solid ${color.primary}`,
        borderRadius: radius.sm,
        fontFamily: font.sans,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {children}
    </button>
  );
}

function frame(child: ReactNode) {
  return <div style={{ background: color.bg, padding: 32 }}>{child}</div>;
}

/** Idle — the default state, button shows its label. */
export const Idle: Story<typeof InlineProgress> = {
  args: { pending: false, mode: 'inline' },
  render: (args: Args) =>
    frame(
      <FakeButton>
        <InlineProgress {...args}>Archive</InlineProgress>
      </FakeButton>,
    ),
};

/** Pending (inline overlay) — spinner replaces the label without layout shift. */
export const PendingInline: Story<typeof InlineProgress> = {
  args: { pending: true, mode: 'inline' },
  render: (args: Args) =>
    frame(
      <FakeButton disabled>
        <InlineProgress {...args}>Archive</InlineProgress>
      </FakeButton>,
    ),
};

/** Pending (trailing) — spinner sits after the label for row-level progress. */
export const PendingTrailing: Story<typeof InlineProgress> = {
  args: { pending: true, mode: 'trailing' },
  render: (args: Args) =>
    frame(
      <FakeButton disabled>
        <InlineProgress {...args}>Unsubscribing</InlineProgress>
      </FakeButton>,
    ),
};
