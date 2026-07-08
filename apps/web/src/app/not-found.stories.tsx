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

import { NotFoundView } from './not-found';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story = {
  parameters?: Record<string, unknown>;
  render: () => ReturnType<typeof NotFoundView>;
};

const meta: StoryMeta<typeof NotFoundView> = {
  title: 'AppShell/Errors/NotFound',
  component: NotFoundView,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Custom 404 page (D167 / D140). Calm, branded, never apologetic — matches D209 microcopy. Audience-aware: a signed-in visitor is routed back into the app (Triage / Senders); an anonymous visitor gets marketing destinations (Home / Pricing). No Sentry capture (404s are expected outcomes).',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Signed-in visitor — routed back into the app. */
export const Authed: Story = {
  render: () => <NotFoundView authed />,
};

/** Anonymous visitor — routed to marketing destinations. */
export const Anonymous: Story = {
  render: () => <NotFoundView authed={false} />,
};
