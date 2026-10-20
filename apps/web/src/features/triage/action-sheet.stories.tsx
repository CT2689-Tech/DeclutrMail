import { useState, type ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from '@declutrmail/shared';
import type { ActionReach } from '@declutrmail/shared/contracts';
import { ActionSheet } from './action-sheet';
import { TRIAGE_QUEUE } from './fixtures';
import { InlinePreviewBlock } from './inline-preview';
import { BatchActionSheet } from './batch-action-sheet';

const sampleRow = {
  ...TRIAGE_QUEUE[0]!,
  senderName: 'Fieldnotes',
  senderEmail: 'weekly@fieldnotes.example',
  senderDomain: 'fieldnotes.example',
  brandMark: false,
};

function CleanupStory(args: ComponentProps<typeof ActionSheet>) {
  const [open, setOpen] = useState(args.open);
  const [reach, setReach] = useState<ActionReach>('inbox_only');
  const [result, setResult] = useState('');
  const inboxCount = typeof args.inboxCount === 'number' ? args.inboxCount : null;
  const allMailCount = inboxCount === null ? null : inboxCount + 18;
  const activeReach = args.verb === 'Delete' ? reach : 'inbox_only';
  const count =
    activeReach === 'all_mail' && allMailCount !== null ? allMailCount : args.inboxCount;
  return (
    <div style={{ padding: 24 }}>
      <p>Fictional mailbox · no Gmail changes. Triage keeps its Any age default.</p>
      <Button
        onClick={() => {
          setReach('inbox_only');
          setOpen(true);
        }}
      >
        Review {args.verb}
      </Button>
      {result && <p role="status">{result}</p>}
      <ActionSheet
        {...args}
        open={open}
        reach={activeReach}
        inboxCount={count}
        detail={{
          reachControl: {
            reach,
            inboxCount,
            allMailCount,
            onChange: setReach,
          },
        }}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setResult(`Sample confirmation: ${args.verb} ${count} emails, ${activeReach}, any age.`);
          setOpen(false);
        }}
      />
    </div>
  );
}

const meta = {
  title: 'Triage/ActionSheet',
  component: ActionSheet,
  render: (args) => <CleanupStory {...args} />,
  args: {
    open: true,
    verb: 'Delete',
    row: sampleRow,
    inboxCount: 128,
    mailboxEmail: 'sample@example.com',
    onCancel: () => undefined,
    onConfirm: () => undefined,
  },
} satisfies Meta<typeof ActionSheet>;
export default meta;
type Story = StoryObj<typeof meta>;
export const DeleteDefault: Story = {};
export const DeleteLoading: Story = { args: { inboxCount: 'loading' } };
export const DeleteUnavailable: Story = { args: { inboxCount: 'unavailable' } };
export const DeleteEmptyInbox: Story = { args: { inboxCount: 0 } };
export const DeleteProtected: Story = {
  args: { row: { ...sampleRow, protectionReason: 'manual' } },
};

export const ArchiveDefault: Story = { args: { verb: 'Archive' } };
export const ArchiveLoading: Story = { args: { verb: 'Archive', inboxCount: 'loading' } };
export const ArchiveUnavailable: Story = { args: { verb: 'Archive', inboxCount: 'unavailable' } };
export const ArchiveEmptyInbox: Story = { args: { verb: 'Archive', inboxCount: 0 } };
export const ArchiveProtected: Story = {
  args: { verb: 'Archive', row: { ...sampleRow, protectionReason: 'manual' } },
};

function InlineArchiveStory(args: ComponentProps<typeof ActionSheet>) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ maxWidth: 680, margin: '24px auto', padding: 16 }}>
      <p>Fictional mailbox · no Gmail changes. Triage inline Archive keeps Inbox only · Any age.</p>
      {open ? (
        <InlinePreviewBlock
          row={args.row ?? sampleRow}
          preview={{
            verb: 'Archive',
            archiveHistoric: false,
            inboxCount: args.inboxCount,
            onCancel: () => setOpen(false),
          }}
          busy={false}
          shortcutLive={false}
          onConfirm={() => setOpen(false)}
        />
      ) : (
        <Button onClick={() => setOpen(true)}>Review Archive</Button>
      )}
    </div>
  );
}
export const ArchiveInline: Story = {
  args: { verb: 'Archive' },
  render: (args) => <InlineArchiveStory {...args} />,
};

const batchRows = [
  sampleRow,
  {
    ...sampleRow,
    id: 'fieldnotes-second',
    senderId: 'fieldnotes-second',
    senderName: 'Fieldnotes Events',
  },
];
const batch = {
  domain: 'fieldnotes.example',
  startIndex: 0,
  rows: batchRows,
  eligibleRows: batchRows,
};
const batchCounts = {
  all: 128,
  olderThan30d: 120,
  olderThan90d: 104,
  olderThan180d: 84,
  olderThan365d: 24,
};
function BatchArchiveStory(args: ComponentProps<typeof ActionSheet>) {
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState('');
  const preview =
    typeof args.inboxCount === 'number'
      ? {
          senders: batchRows.map((row) => ({
            senderId: row.senderId,
            name: row.senderName,
            protected: false,
            counts: batchCounts,
          })),
          totals: { ...batchCounts, all: 256 },
          protectedCount: 0,
        }
      : args.inboxCount;
  return (
    <div style={{ padding: 24 }}>
      <p>Fictional mailbox · no Gmail changes. Triage group Archive keeps Inbox only · Any age.</p>
      <Button onClick={() => setOpen(true)}>Review Archive</Button>
      {result && <p role="status">{result}</p>}
      <BatchActionSheet
        open={open}
        verb="Archive"
        batch={batch}
        preview={preview}
        mailboxEmail="sample@example.com"
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setResult('Sample confirmation: Archive 256 inbox emails, any age.');
          setOpen(false);
        }}
      />
    </div>
  );
}
export const ArchiveBatch: Story = {
  args: { verb: 'Archive' },
  render: (args) => <BatchArchiveStory {...args} />,
};
