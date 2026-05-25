// Storybook CSF3 stories for the 404 page (D167).
//
// The page renders outside the authed app shell — no provider wrap is
// required at runtime. For Storybook we still frame it in the warm
// background so it reads correctly against the editorial palette.
//
// Mirrors the local-shim pattern from `privacy-badge.stories.tsx` so
// the file typechecks before the PR-3 Storybook seed lands (D210).
// When the seed merges, swap the shims for `@storybook/react`
// imports — the story shapes do not change.

import type { ComponentProps } from 'react';
import NotFound from './not-found';

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

const meta: StoryMeta<typeof NotFound> = {
  title: 'AppShell/Errors/NotFound',
  component: NotFound,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Custom 404 page (D167). Calm, branded, never apologetic — matches D209 microcopy. Routes back to /triage (the daily ritual) and /senders. No Sentry capture (404s are expected outcomes).',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Default — the only state the 404 page has. */
export const Default: Story<typeof NotFound> = {
  render: (_args: ComponentProps<typeof NotFound>) => <NotFound />,
};
