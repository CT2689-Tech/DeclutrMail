// Storybook CSF3 stories for the global App Router error boundary
// (D167). This is the boundary Next.js mounts when the root layout
// itself throws — it owns its own <html>/<body> tags and falls back
// to a system font stack (the layout's Geist/JetBrains Mono vars are
// unavailable when the layout crashed).
//
// Caveat: rendering an <html> element inside Storybook's already-
// present <html> emits a React hydration warning. The story still
// renders correctly. When the seed lands (D210) and we run real
// Storybook, switch the `render` to mount into an iframe (Storybook
// supports `parameters.docs.story.inline = false`) to silence it.

import type { ComponentProps } from 'react';
import GlobalError from './global-error';

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

const meta: StoryMeta<typeof GlobalError> = {
  title: 'AppShell/Errors/GlobalError',
  component: GlobalError,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Outer error boundary mounted when the root layout crashes (D167). Includes its own <html>/<body>. Auto-fires Sentry with `boundary: app-router-global-error`.',
      },
      // Render in an iframe once Storybook is seeded, to avoid the
      // nested <html> hydration warning.
      story: { inline: false },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type GlobalErrArgs = ComponentProps<typeof GlobalError>;

const noopReset = () => {
  /* Storybook no-op — real reset is wired by Next.js at runtime. */
};

/** Default — fallback render when the root layout itself errored. */
export const Default: Story<typeof GlobalError> = {
  render: (_args: GlobalErrArgs) => (
    <GlobalError
      error={Object.assign(new Error('Layout crashed'), {
        digest: '7f2a9100deadbeef',
      })}
      reset={noopReset}
    />
  ),
};
