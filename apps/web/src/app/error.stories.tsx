// Storybook CSF3 stories for the App Router error boundary (D167).
//
// The boundary auto-fires `Sentry.captureException` on mount. In
// Storybook the wrapper bails early (no `NEXT_PUBLIC_SENTRY_DSN`), so
// stories are quiet — no real Sentry events are sent from the
// Storybook canvas.
//
// `reset` is wired to a no-op for stories. In production Next.js
// supplies the actual reset callback that re-attempts render.
//
// Mirrors the local-shim pattern from `privacy-badge.stories.tsx` so
// the file typechecks before the PR-3 Storybook seed lands (D210).

import type { ComponentProps } from 'react';
import AppError from './error';

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

const meta: StoryMeta<typeof AppError> = {
  title: 'AppShell/Errors/AppError',
  component: AppError,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'App Router error boundary (D167). Calm, branded copy. Auto-fires Sentry capture on mount with a `boundary: app-router-error` tag. Reset retries the failed render; the secondary link routes home.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type ErrArgs = ComponentProps<typeof AppError>;

const noopReset = () => {
  /* Storybook no-op — real reset is wired by Next.js at runtime. */
};

/** Default — the most common case: a thrown Error with no digest. */
export const Default: Story<typeof AppError> = {
  render: (_args: ErrArgs) => (
    <AppError
      error={Object.assign(new Error('Boundary demo — no digest'), {
        digest: undefined,
      })}
      reset={noopReset}
    />
  ),
};

/** WithDigest — server-component throws surface a Next.js digest hash. */
export const WithDigest: Story<typeof AppError> = {
  render: (_args: ErrArgs) => (
    <AppError
      error={Object.assign(new Error('Server component threw'), {
        digest: 'a1b2c3d4e5f60718',
      })}
      reset={noopReset}
    />
  ),
};
