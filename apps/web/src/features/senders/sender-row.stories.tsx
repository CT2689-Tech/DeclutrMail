// Storybook CSF3 stories for one Senders row (D210). `SenderList` stories
// show the rows together; these pin each state of a single row: at rest,
// selected, Protected, busy with an action, unsubscribe requested, and
// the phone (`compact`) layout.

import type { Sender } from './data';
import { RowActivityProvider, type SenderRowActivity } from './row-activity';
import { SenderRow } from './sender-row';
import { makeSender } from './testing/make-sender';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story = { render: () => React.ReactElement };

const meta: StoryMeta<typeof SenderRow> = {
  title: 'Senders/SenderRow',
  component: SenderRow,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One sender: checkbox, name and address, one number, one verb + ⋯. While an action runs the verb button becomes the status. On phones (`compact`) the verb button drops out for ⋯ and swipe-right.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

const SUBSTACK = makeSender({
  id: 's1',
  displayName: 'Substack',
  email: 'no-reply@substack.com',
  domain: 'substack.com',
  totalReceived: 1204,
  unsubscribeMethod: 'one_click',
});

const CHASE = makeSender({
  id: 's2',
  displayName: 'Chase',
  email: 'alerts@chase.com',
  domain: 'chase.com',
  totalReceived: 312,
  gmailCategory: 'primary',
  protectionFlags: { isProtected: true, protectionReason: 'starred', protectionSetAt: null },
});

const OLD_NAVY = makeSender({
  id: 's3',
  displayName: 'Old Navy',
  email: 'deals@oldnavy.com',
  domain: 'oldnavy.com',
  totalReceived: 88,
  policyType: 'unsubscribe',
  unsubStatus: 'endpoint_accepted',
});

function Row({
  s,
  selected = false,
  compact = false,
  activity,
}: {
  s: Sender;
  selected?: boolean;
  compact?: boolean;
  activity?: SenderRowActivity;
}) {
  return (
    <RowActivityProvider value={new Map(activity ? [[s.id, activity]] : [])}>
      <div role="list" aria-label="Senders" style={{ maxWidth: compact ? 375 : 880 }}>
        <SenderRow
          s={s}
          selected={selected}
          compact={compact}
          onToggleSelect={() => undefined}
          onOpen={() => undefined}
          onAction={() => undefined}
        />
      </div>
    </RowActivityProvider>
  );
}

export const Rest: Story = { render: () => <Row s={SUBSTACK} /> };

export const Selected: Story = { render: () => <Row s={SUBSTACK} selected /> };

export const Protected: Story = { render: () => <Row s={CHASE} /> };

export const Busy: Story = {
  render: () => <Row s={SUBSTACK} activity={{ phase: 'working', verb: 'archive' }} />,
};

export const UnsubscribeRequested: Story = { render: () => <Row s={OLD_NAVY} /> };

export const Compact: Story = { render: () => <Row s={SUBSTACK} compact /> };

export const CompactBusy: Story = {
  render: () => <Row s={SUBSTACK} compact activity={{ phase: 'working', verb: 'archive' }} />,
};
