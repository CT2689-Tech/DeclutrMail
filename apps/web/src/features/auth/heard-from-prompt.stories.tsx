// Storybook CSF3 stories for the first-login self-report prompt (D258).
//
// The presentational `HeardFromPromptView` is storied (props only) so every
// state renders without mounting `AuthProvider` or a QueryClient — the same
// split `no-active-mailbox.stories.tsx` uses.
//
// Variants (D211 edge-state coverage):
//   • Idle      — the ask, nothing chosen yet
//   • Typing    — free-text entered, so Send is enabled
//   • Busy      — a choice is in flight, every control disabled
//   • Failed    — the PATCH failed and the card says so instead of
//                 silently resetting itself

import type { ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';
import { HeardFromPromptView } from './heard-from-prompt';

const { color } = tokens;

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

const meta: StoryMeta<typeof HeardFromPromptView> = {
  title: 'Auth/HeardFromPrompt',
  component: HeardFromPromptView,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Skippable first-login self-report (D258) — the SECOND of the two attribution ' +
          'signals, never summed with the tracked `ref`. It is not a sixth onboarding step: ' +
          'it sits on authed chrome and blocks neither sync nor triage. Fixed bottom-LEFT at ' +
          'z-index 140, and it waits for the cookie-consent banner (bottom-right, z-index 150) ' +
          'to be answered — below a 832px viewport both cards occupy the same rectangle, so ' +
          'showing them together hides this one entirely on a phone.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type Args = ComponentProps<typeof HeardFromPromptView>;

const noop = () => {};

function frame(args: Args) {
  return (
    <div style={{ background: color.bg, minHeight: '100vh' }}>
      <HeardFromPromptView {...args} />
    </div>
  );
}

const BASE: Args = {
  busy: false,
  failed: false,
  otherDetail: '',
  onOtherDetailChange: noop,
  onChoose: noop,
  onSkip: noop,
  onSubmitOther: noop,
};

/** Idle — the ask as a first-login user meets it. Send is disabled until text exists. */
export const Idle: Story<typeof HeardFromPromptView> = {
  args: BASE,
  render: (args) => frame(args),
};

/** Typing — free text entered, so the Send action becomes available. */
export const Typing: Story<typeof HeardFromPromptView> = {
  args: { ...BASE, otherDetail: 'A podcast I listen to' },
  render: (args) => frame(args),
};

/** Busy — a choice is in flight; every control is disabled so it cannot double-submit. */
export const Busy: Story<typeof HeardFromPromptView> = {
  args: { ...BASE, otherDetail: 'A podcast I listen to', busy: true },
  render: (args) => frame(args),
};

/** Failed — the PATCH failed. The card SAYS so and stays retryable. */
export const Failed: Story<typeof HeardFromPromptView> = {
  args: { ...BASE, otherDetail: 'A podcast I listen to', failed: true },
  render: (args) => frame(args),
};
