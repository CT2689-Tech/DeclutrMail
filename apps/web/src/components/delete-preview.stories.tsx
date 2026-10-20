import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { DeleteImpact, DeletePreview } from './delete-preview';

const meta = {
  title: 'Actions/DeletePreview',
  component: DeletePreview,
  args: {
    olderThanDays: 180,
    options: [{ days: null }, { days: 30 }, { days: 90 }, { days: 180 }, { days: 365 }],
    onWindowChange: () => undefined,
    showWindow: true,
    children: (
      <DeleteImpact
        count={84}
        includesArchived={false}
        olderThanDays={180}
        note="Undo from Activity for 30 days."
      />
    ),
  },
} satisfies Meta<typeof DeletePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Archived: Story = {
  args: {
    children: (
      <DeleteImpact
        count={410}
        includesArchived
        olderThanDays={180}
        note="Undo from Activity for 30 days."
      />
    ),
  },
};
/** The parent owns loading/failure status and blocks confirmation in both states. */
export const Unresolved: Story = {
  args: {
    children: <DeleteImpact count={null} includesArchived={false} olderThanDays={180} note="" />,
  },
};
export const Empty: Story = {
  args: {
    children: <DeleteImpact count={0} includesArchived={false} olderThanDays={180} note="" />,
  },
};
export const MissingAgeBucket: Story = {
  args: { options: [{ days: null }, { days: 180, disabled: true }], children: null },
};
