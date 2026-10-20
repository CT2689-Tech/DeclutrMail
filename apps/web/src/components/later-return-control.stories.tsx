import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { defaultLaterWakeAtIso } from '@declutrmail/shared/actions';
import { LaterReturnControl } from './later-return-control';

const meta: Meta<typeof LaterReturnControl> = {
  title: 'Actions/LaterReturnControl',
  component: LaterReturnControl,
  render: function ReturnStory(args) {
    const [value, setValue] = useState<string | null>(args.value ?? defaultLaterWakeAtIso());
    return <LaterReturnControl value={value} onChange={setValue} />;
  },
  args: { onChange: () => undefined },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
