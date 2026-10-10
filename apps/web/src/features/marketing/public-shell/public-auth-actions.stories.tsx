import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PublicAuthActions } from './public-auth-actions';

const meta = {
  title: 'Marketing/Public auth actions',
  component: PublicAuthActions,
  beforeEach: () => {
    document.cookie = 'dm_csrf=; Max-Age=0; path=/';
    return () => {
      document.cookie = 'dm_csrf=; Max-Age=0; path=/';
    };
  },
} satisfies Meta<typeof PublicAuthActions>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SignedOut: Story = {};
export const SessionHint: Story = {
  beforeEach: () => {
    document.cookie = 'dm_csrf=synthetic-story-hint; path=/';
  },
};
