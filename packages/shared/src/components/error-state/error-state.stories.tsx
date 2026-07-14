import type { ComponentProps } from 'react';

import { color } from '../../tokens/tokens';
import { ErrorState } from './error-state';

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

const meta: StoryMeta<typeof ErrorState> = {
  title: 'Primitives/ErrorState',
  component: ErrorState,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Retryable read-failure surface. Solid amber treatment and alert semantics distinguish an unknown result from a successful empty state.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type ErrorArgs = ComponentProps<typeof ErrorState>;

function frame(child: React.ReactNode) {
  return <div style={{ background: color.bg, padding: 32, maxWidth: 560 }}>{child}</div>;
}

export const Default: Story<typeof ErrorState> = {
  args: {
    title: "Your queue didn't load",
    description: 'Your mailbox and decisions are untouched. Try again in a moment.',
    onRetry: () => undefined,
  },
  render: (args: ErrorArgs) => frame(<ErrorState {...args} />),
};
