import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { RULE_PREVIEW_RESULT } from './fixtures';
import { RulePreviewPanel } from './rule-preview-panel';

const noInbox = {
  ...RULE_PREVIEW_RESULT,
  wouldMatchCount: 1,
  actionableSenderCount: 0,
  actionableMessageCount: 0,
  evaluatedSenders: 7704,
  protectedWouldMatchCount: 0,
  sample: [
    {
      senderKey: 'synthetic-newsletter',
      senderName: 'Synthetic Newsletter',
      senderEmail: 'newsletter@example.com',
      inboxCount: 0,
      reason: 'Archive confidence 92%',
    },
  ],
};

const meta = {
  title: 'Autopilot/RulePreviewPanel',
  component: RulePreviewPanel,
  args: {
    ruleName: 'Synthetic Archive rule',
    actionKind: 'archive',
    state: { status: 'ready', result: noInbox },
    onRetry: () => undefined,
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 1000, padding: 24 }}>
        <h2>Current rule preview</h2>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RulePreviewPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MatchesWithoutInbox: Story = {};
export const MixedMatches: Story = {
  args: { state: { status: 'ready', result: RULE_PREVIEW_RESULT } },
};
export const AlreadyUnsubscribed: Story = {
  args: { actionKind: 'unsubscribe', state: { status: 'ready', result: noInbox } },
};
export const NoMatches: Story = {
  args: {
    state: { status: 'ready', result: { ...noInbox, wouldMatchCount: 0, sample: [] } },
  },
};
export const Loading: Story = { args: { state: { status: 'loading' } } };
export const Error: Story = {
  args: { state: { status: 'error', message: 'Could not load this preview. Try again.' } },
};
