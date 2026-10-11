import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ScanPreviewView } from './scan-preview';
const meta: Meta<typeof ScanPreviewView> = {
  title: 'Onboarding/ReadOnlyScanPreview',
  component: ScanPreviewView,
  args: { open: true, toggle: () => {}, refresh: () => {} },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Closed: Story = { args: { open: false, state: 'ready' } };
export const Indexed: Story = {
  args: {
    state: 'ready',
    data: [
      { name: 'Example Journal', indexedEmails: 48 },
      { name: 'Studio Notes', indexedEmails: 7 },
    ],
  },
};
export const Empty: Story = { args: { state: 'ready', data: [] } };
export const Loading: Story = { args: { state: 'loading' } };
export const Error: Story = { args: { state: 'error' } };
