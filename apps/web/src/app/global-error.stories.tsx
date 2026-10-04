// Storybook CSF3 stories for the global App Router error boundary
// (D167). This is the boundary Next.js mounts when the root layout
// itself throws — it owns its own <html>/<body> tags and falls back
// to a system font stack (the layout's Geist/JetBrains Mono vars are
// unavailable when the layout crashed).
//
// Storybook renders the same fallback content inside its existing document.

import type { ComponentProps } from 'react';
import { GlobalErrorContent } from './global-error';

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

const meta: StoryMeta<typeof GlobalErrorContent> = {
  title: 'AppShell/Errors/GlobalError',
  component: GlobalErrorContent,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Fallback content used by the outer error boundary when the root layout crashes (D167). The production boundary supplies its own document.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type GlobalErrArgs = ComponentProps<typeof GlobalErrorContent>;

const noopReset = () => {
  /* Storybook no-op — real reset is wired by Next.js at runtime. */
};

/** Default — fallback render when the root layout itself errored. */
export const Default: Story<typeof GlobalErrorContent> = {
  render: (_args: GlobalErrArgs) => (
    <GlobalErrorContent
      error={Object.assign(new Error('Layout crashed'), { digest: '7f2a9100deadbeef' })}
      reset={noopReset}
    />
  ),
};
