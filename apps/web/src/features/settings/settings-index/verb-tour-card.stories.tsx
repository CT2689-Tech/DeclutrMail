// Storybook CSF3 stories for the D38 replay control (Settings →
// Actions).
//
// One state: the card is stateless by design. D38 gives the tour a
// single showing, so the only thing Settings owns is the door back to
// it — and that door is open regardless of whether the tour has been
// seen. The states worth looking at (first run / dismissed / replayed)
// live on the tour itself, in `Onboarding/VerbTour`.
//
// Same lightweight local CSF shims as its sibling settings cards.

import { VerbTourCard } from './verb-tour-card';

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

const meta: StoryMeta<typeof VerbTourCard> = {
  title: 'Settings/VerbTourCard',
  component: VerbTourCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Re-opens the D38 verb tour after onboarding, where there is no step 5 to return to. Carries no seen/unseen status: the tour is available either way, so a status line would only describe a flag the user cannot act on.',
      },
    },
  },
};
export default meta;

export const Default: Story<typeof VerbTourCard> = {
  render: () => <VerbTourCard onReplay={() => {}} />,
};
