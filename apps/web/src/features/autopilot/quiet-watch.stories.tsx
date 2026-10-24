import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QuietWatch } from './quiet-watch';

const meta = {
  title: 'Autopilot/QuietWatch',
  component: QuietWatch,
  args: { watching: 3, automatic: 0, paused: false, onReview: () => {} },
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
} satisfies Meta<typeof QuietWatch>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Watching: Story = {};
export const FirstRule: Story = { args: { watching: 0 } };
export const Paused: Story = { args: { watching: 0, paused: true } };
export const ActivePresets: Story = { args: { automatic: 2 } };
