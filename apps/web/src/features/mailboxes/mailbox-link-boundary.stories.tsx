import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { MailboxLinkView } from './mailbox-link-resolver';
const meta: Meta<typeof MailboxLinkView> = {
  title: 'Mailboxes/EmailedInboxLink',
  component: MailboxLinkView,
  args: { retry: () => {}, settings: () => {}, dismiss: () => {} },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Opening: Story = { args: { phase: 'opening' } };
export const Unavailable: Story = { args: { phase: 'invalid' } };
export const Error: Story = { args: { phase: 'error' } };
