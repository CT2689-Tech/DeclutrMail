// Storybook CSF3 stories for the ViewToggle segmented control (D49, D210).
//
// D49: a segmented control at top right offers [Grid | Table]; grid is
// the default and the choice is remembered per device (2026-09-20). State
// lives in `useSendersStore` (D200), so these stories seed the store's
// `view` before render to pin both active states for the design-system
// gate (D210). The button is a pure store read/write — no network.

import { useEffect } from 'react';
import { ViewToggle } from './view-toggle';
import { useSendersStore, type SendersView } from './store';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story = {
  parameters?: Record<string, unknown>;
  render: () => ReturnType<typeof ViewToggle>;
};

const meta: StoryMeta<typeof ViewToggle> = {
  title: 'Senders/ViewToggle',
  component: ViewToggle,
  parameters: {
    docs: {
      description: {
        component:
          'Segmented [Grid | Table] switch (D49). Grid is the default surface; Table is the opt-in, remembered per device (see `store.ts`). Clicking a segment flips `useSendersStore.view`; the senders screen swaps its body between the card grid and the flat sortable table.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Seed the store's `view` so a story renders a deterministic active state. */
function WithView({ view }: { view: SendersView }) {
  useEffect(() => {
    useSendersStore.setState({ view });
  }, [view]);
  return <ViewToggle />;
}

export const GridActive: Story = {
  render: () => <WithView view="grid" />,
};

export const TableActive: Story = {
  render: () => <WithView view="table" />,
};
