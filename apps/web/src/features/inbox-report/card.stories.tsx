import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { InboxReportCard } from './card';

const meta: Meta<typeof InboxReportCard> = {
  title: 'InboxReport/HomeCard',
  component: InboxReportCard,
  args: { surface: 'home', mailboxId: 'mb-1' },
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof meta>;

/** Title, body, and a separate Open report action. Copy is the deck. */
export const Home: Story = {};
