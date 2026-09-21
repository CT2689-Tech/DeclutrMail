// Storybook CSF3 stories for the Senders list (D210) — the ONE layout:
// hairline rows, one number, one verb + ⋯, collapsible domain groups.
// Pins the row's states: plain, Protected, unsubscribe lifecycle, selected,
// open in the pane, busy / done (#751–#753), and the phone (`compact`) row.

import { useState } from 'react';
import { rollupByDomain } from './domain-rollup';
import { RowActivityProvider, type RowActivityById } from './row-activity';
import { SenderList } from './sender-list';
import { makeSender } from './testing/make-sender';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story = { render: () => React.ReactElement };

const meta: StoryMeta<typeof SenderList> = {
  title: 'Senders/SenderList',
  component: SenderList,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The single Senders layout. Row click opens the sender (side pane at ≥1100px, else the full page); checkbox, verb and ⋯ never do. Every mutation routes through the host’s D226 preview.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

const SENDERS = [
  makeSender({
    id: 's1',
    displayName: 'Substack',
    email: 'no-reply@substack.com',
    domain: 'substack.com',
    totalReceived: 1204,
    unsubscribeMethod: 'one_click',
  }),
  makeSender({
    id: 's2',
    displayName: 'Chase',
    email: 'alerts@chase.com',
    domain: 'chase.com',
    totalReceived: 312,
    gmailCategory: 'primary',
    protectionFlags: { isProtected: true, protectionReason: 'starred', protectionSetAt: null },
  }),
  makeSender({
    id: 's3',
    displayName: 'Old Navy',
    email: 'deals@oldnavy.com',
    domain: 'oldnavy.com',
    totalReceived: 88,
    policyType: 'unsubscribe',
    unsubStatus: 'endpoint_accepted',
  }),
  ...['news', 'jobs', 'invites'].map((local, i) =>
    makeSender({
      id: `g${i}`,
      displayName: `LinkedIn ${local}`,
      email: `${local}@linkedin.com`,
      domain: 'linkedin.com',
      totalReceived: 400 - i * 90,
    }),
  ),
];

function Harness({
  activity = new Map(),
  compact = false,
  activeId = null,
  initiallySelected = [],
}: {
  activity?: RowActivityById;
  compact?: boolean;
  activeId?: string | null;
  initiallySelected?: string[];
}) {
  const [selected, setSelected] = useState(() => new Set(initiallySelected));
  const [open, setOpen] = useState(activeId);
  return (
    <RowActivityProvider value={activity}>
      <div style={{ maxWidth: compact ? 375 : 880 }}>
        <SenderList
          entries={rollupByDomain(SENDERS)}
          selectedIds={selected}
          onToggleSelect={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onAction={() => undefined}
          onOpen={setOpen}
          activeId={open}
          compact={compact}
          followKeys
        />
      </div>
    </RowActivityProvider>
  );
}

export const Default: Story = { render: () => <Harness /> };

export const SelectedAndOpen: Story = {
  render: () => <Harness initiallySelected={['s1']} activeId="s2" />,
};

export const RowsSayWhatIsHappening: Story = {
  render: () => (
    <Harness
      activity={
        new Map([
          ['s1', { phase: 'working', verb: 'archive' }],
          ['s2', { phase: 'done', verb: 'delete', affectedCount: 251 }],
          ['s3', { phase: 'failed', verb: 'later' }],
          ['g0', { phase: 'working', verb: 'archive' }],
        ])
      }
    />
  ),
};

export const Phone: Story = {
  render: () => (
    <Harness compact activity={new Map([['s1', { phase: 'working', verb: 'archive' }]])} />
  ),
};
