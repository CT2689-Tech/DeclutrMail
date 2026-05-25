// Storybook CSF3 stories for the skeleton primitives + composites
// (D166). Mirrors the local-shim CSF types used by
// `privacy-badge.stories.tsx` so it typechecks before the PR-3
// Storybook seed lands (D210). Swap the shims for `@storybook/react`
// imports when the seed merges; story shapes do not change.

import type { ComponentProps, ReactNode } from 'react';

import { color } from '../../tokens/tokens';
import { Skeleton, SkeletonLines } from './skeleton';
import { TriageQueueSkeleton } from './triage-queue-skeleton';
import { SendersListSkeleton } from './sender-row-skeleton';
import { SenderDetailSkeleton } from './sender-detail-skeleton';

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

const meta: StoryMeta<typeof Skeleton> = {
  title: 'Loading/Skeleton',
  component: Skeleton,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'D166 skeleton-first loading primitive. Three variants — text, circle, rect — plus a SkeletonLines helper for paragraph-shaped placeholders. Animation honours prefers-reduced-motion via the global CSS rule in tokens.css.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type SkeletonArgs = ComponentProps<typeof Skeleton>;

function frame(child: ReactNode, options: { width?: number | string } = {}) {
  return (
    <div
      style={{
        background: color.bg,
        padding: 24,
        width: options.width ?? 360,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {child}
    </div>
  );
}

/** Text variant — the default; a single body line. */
export const Text: Story<typeof Skeleton> = {
  args: { variant: 'text', width: '60%' },
  render: (args: SkeletonArgs) => frame(<Skeleton {...args} />),
};

/** Circle variant — avatars + icon placeholders. */
export const Circle: Story<typeof Skeleton> = {
  args: { variant: 'circle', width: 48, height: 48 },
  render: (args: SkeletonArgs) => frame(<Skeleton {...args} />),
};

/** Rect variant — cards, images, full blocks. */
export const Rect: Story<typeof Skeleton> = {
  args: { variant: 'rect', height: 120 },
  render: (args: SkeletonArgs) => frame(<Skeleton {...args} />),
};

/** Paragraph helper — three text lines, tapered last row. */
export const Paragraph: Story<typeof SkeletonLines> = {
  args: { lines: 3 },
  render: (args) => frame(<SkeletonLines {...args} />),
};

/** Composite — triage queue (D29 / D36): five collapsed row cards. */
export const TriageQueue: Story<typeof TriageQueueSkeleton> = {
  args: { rows: 5 },
  render: (args) => frame(<TriageQueueSkeleton {...args} />, { width: 640 }),
};

/** Composite — senders list (D38–D43): six rows. */
export const SendersList: Story<typeof SendersListSkeleton> = {
  args: { rows: 6 },
  render: (args) => frame(<SendersListSkeleton {...args} />, { width: 720 }),
};

/** Composite — sender detail page (D38–D43, D194): full assembly. */
export const SenderDetail: Story<typeof SenderDetailSkeleton> = {
  render: () => frame(<SenderDetailSkeleton />, { width: 880 }),
};
