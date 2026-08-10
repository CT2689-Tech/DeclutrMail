// Storybook CSF3 stories for the Noise archive preview (D65, D226, D210).
//
// This sheet is the D226 gate: no Noise mail moves without it, so its
// three preview states each get a story — the in-flight count, the
// failed read, and the resolved count that finally arms confirm.
//
// Mirrors the local-shim pattern from sibling story files so this
// typechecks before the PR-3 Storybook seed merges (D210).

import type { ComponentProps } from 'react';

import { tokens } from '@declutrmail/shared';

import type { NoiseTarget } from './api/use-noise-archive';
import { NoiseArchiveSheet } from './noise-archive-sheet';

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

const TARGETS: NoiseTarget[] = [
  {
    senderKey: 'sk-news',
    senderName: 'Newsletter Daily',
    messageCount: 4,
    senderId: 'aaaaaaaa-0000-4000-8000-000000000001',
    isProtected: false,
  },
  {
    senderKey: 'sk-shop',
    senderName: 'Old Navy',
    messageCount: 3,
    senderId: 'aaaaaaaa-0000-4000-8000-000000000002',
    isProtected: false,
  },
  {
    senderKey: 'sk-food',
    senderName: 'DoorDash',
    messageCount: 2,
    senderId: 'aaaaaaaa-0000-4000-8000-000000000003',
    isProtected: false,
  },
];

const noop = () => {};

function frame(props: Partial<ComponentProps<typeof NoiseArchiveSheet>>) {
  return (
    <div style={{ background: tokens.color.bg, minHeight: 520 }}>
      <NoiseArchiveSheet
        open
        targets={TARGETS}
        preview="loading"
        mailboxEmail="you@example.com"
        onCancel={noop}
        onConfirm={noop}
        onRetryPreview={noop}
        {...props}
      />
    </div>
  );
}

const meta: StoryMeta<typeof NoiseArchiveSheet> = {
  title: 'Features/Brief/NoiseArchiveSheet',
  component: NoiseArchiveSheet,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Mandatory action preview for the Brief Noise bulk archive (D65, D226). Confirm is armed only by a resolved live count from the server; the loading and unavailable states both block it. The scope sentence names what the archive reaches, because the Noise heading counts yesterday and the action reaches the whole inbox.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** In flight — the live count has not landed, so confirm stays locked. */
export const CountingInbox: Story<typeof NoiseArchiveSheet> = {
  render: () => frame({ preview: 'loading' }),
};

/** Preview read failed — confirm stays locked and a retry is offered. */
export const PreviewUnavailable: Story<typeof NoiseArchiveSheet> = {
  render: () => frame({ preview: 'unavailable' }),
};

/** Resolved — real per-sender counts, and the only state that can confirm. */
export const Ready: Story<typeof NoiseArchiveSheet> = {
  render: () =>
    frame({
      preview: {
        totalMessages: 412,
        countBySenderId: new Map([
          ['aaaaaaaa-0000-4000-8000-000000000001', 210],
          ['aaaaaaaa-0000-4000-8000-000000000002', 141],
          ['aaaaaaaa-0000-4000-8000-000000000003', 61],
        ]),
      },
    }),
};

/**
 * One sender left checked — the preview comes from the single-sender
 * endpoint instead of the bulk one, and the copy stays singular.
 */
export const SingleSender: Story<typeof NoiseArchiveSheet> = {
  render: () =>
    frame({
      targets: [TARGETS[0]!],
      preview: {
        totalMessages: 1,
        countBySenderId: new Map([['aaaaaaaa-0000-4000-8000-000000000001', 1]]),
      },
    }),
};
