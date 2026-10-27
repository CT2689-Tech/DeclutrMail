import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { CleanupViewNavigation } from './cleanup-workspace';
import type { CleanupView } from './cleanup-view';

const meta = {
  title: 'Senders/WorkspaceNavigation',
  component: CleanupViewNavigation,
  args: { view: 'all', onChange: () => {} },
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
} satisfies Meta<typeof CleanupViewNavigation>;

export default meta;
type Story = StoryObj<typeof meta>;

function Navigation({ initialView, pending }: { initialView: CleanupView; pending?: number }) {
  const [view, setView] = useState(initialView);
  return <CleanupViewNavigation view={view} pending={pending} onChange={setView} />;
}

export const AllSenders: Story = {
  render: () => <Navigation initialView="all" pending={12} />,
};

export const CountUnknown: Story = {
  render: () => <Navigation initialView="all" />,
};

export const NeedsFirstReview: Story = {
  render: () => <Navigation initialView="first-review" pending={12} />,
};

export const EmptyQueue: Story = {
  render: () => <Navigation initialView="first-review" pending={0} />,
};
