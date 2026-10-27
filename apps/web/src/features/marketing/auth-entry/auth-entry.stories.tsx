// Stories render outside the public route group.
import '../public-styles.css';
import './auth-entry.css';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AuthEntry } from './auth-entry';
const meta = {
  title: 'Marketing/AuthEntry',
  component: AuthEntry,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AuthEntry>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Connect: Story = {};
export const Returning: Story = { args: { returning: true, returnTo: '/activity' } };
export const SignedOut: Story = { args: { signedOut: true } };
export const UnknownAccount: Story = {
  args: {
    returning: true,
    authResult: 'connect_required',
    returnTo: '/billing?plan=pro&cycle=annual',
  },
};
export const Retry: Story = {
  args: { returning: true, authResult: 'failed', returnTo: '/settings' },
};
export const MissingGmailAccess: Story = {
  args: { returning: true, authResult: 'gmail_access_missing' },
};
export const InboxLimit: Story = { args: { authResult: 'inbox_limit' } };
export const RateLimited: Story = {
  args: { returning: true, authResult: 'rate_limited' },
};
