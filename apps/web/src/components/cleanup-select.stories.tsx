import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CleanupSelect } from './cleanup-select';

const meta: Meta<typeof CleanupSelect> = {
  title: 'Actions/CleanupSelect',
  component: CleanupSelect,
  args: {
    'aria-label': 'Email age',
    defaultValue: '180',
    children: [
      <option key="all" value="all">
        Any age
      </option>,
      <option key="180" value="180">
        Older than 180 days
      </option>,
      <option key="365" value="365" disabled>
        Older than 1 year (unavailable)
      </option>,
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 320 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
