import { useState, type ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { cleanupAgeLabel } from '@/components/cleanup-preview';
import { DEFAULT_DELETE_WINDOW_DAYS, defaultLaterWakeAtIso } from '@declutrmail/shared/actions';
import { Button } from '@declutrmail/shared';
import type { ActionReach } from '@declutrmail/shared/contracts';
import { pickBucketCount, TIME_WINDOW_PRESETS } from '@/features/senders/action-window';
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

const archivedCounts = {
  all: 18,
  olderThan30d: 18,
  olderThan90d: 16,
  olderThan180d: 12,
  olderThan365d: 6,
};

function CleanupStory(args: ComponentProps<typeof ActionSheet>) {
  const [open, setOpen] = useState(args.open);
  const defaultDays = args.verb === 'Delete' ? DEFAULT_DELETE_WINDOW_DAYS : null;
  const [days, setDays] = useState<number | null>(defaultDays);
  const [reach, setReach] = useState<ActionReach>('inbox_only');
  const [result, setResult] = useState('');
  const [recovered, setRecovered] = useState(false);
  const fixtureCount = recovered ? 128 : args.inboxCount;
  const [wakeAt, setWakeAt] = useState<string | null>(() =>
    args.verb === 'Later' ? defaultLaterWakeAtIso() : null,
  );
  const inboxCount =
    typeof fixtureCount === 'number'
      ? fixtureCount === 0
        ? 0
        : (pickBucketCount(batchCounts, days) ?? 0)
      : null;
  const allMailCount =
    inboxCount === null ? null : inboxCount + (pickBucketCount(archivedCounts, days) ?? 0);
  const activeReach = args.verb === 'Delete' ? reach : 'inbox_only';
  const count =
    typeof fixtureCount === 'number'
      ? activeReach === 'all_mail'
        ? (allMailCount ?? 0)
        : (inboxCount ?? 0)
      : fixtureCount;
  return (
    <div style={{ padding: 24 }}>
      <p>
        Fictional mailbox · no Gmail changes. {args.verb} starts at{' '}
        {cleanupAgeLabel(defaultDays).toLowerCase()}.
      </p>
      <Button
        onClick={() => {
          setReach('inbox_only');
          setDays(defaultDays);
          setWakeAt(args.verb === 'Later' ? defaultLaterWakeAtIso() : null);
          setOpen(true);
        }}
      >
        Review {args.verb}
      </Button>
      {result && <p role="status">{result}</p>}
      <ActionSheet
        {...args}
        open={open}
        wakeAt={wakeAt}
        reach={activeReach}
        inboxCount={count}
        detail={{
          ...(args.verb === 'Archive' || args.verb === 'Delete' || args.verb === 'Later'
            ? {
                ageControl: {
                  olderThanDays: days,
                  options: TIME_WINDOW_PRESETS,
                  onChange: setDays,
                },
              }
            : {}),
          reachControl: {
            reach,
            inboxCount,
            allMailCount,
            onChange: setReach,
          },
        }}
        onRetryPreview={() => setRecovered(true)}
        onCancel={() => setOpen(false)}
        onConfirm={(details) => {
          setResult(
            `Sample confirmation: ${args.verb} ${count} emails, ${activeReach === 'all_mail' ? 'inbox and archived' : 'inbox only'}, ${cleanupAgeLabel(days).toLowerCase()}${args.verb === 'Later' ? `; return ${details.wakeAt ? new Date(details.wakeAt).toLocaleString('en-US', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) : 'not selected'}` : ''}.`,
          );
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

function InlineCleanupStory(args: ComponentProps<typeof ActionSheet>) {
  const defaultDays = args.verb === 'Delete' ? DEFAULT_DELETE_WINDOW_DAYS : null;
  const [open, setOpen] = useState(true);
  const [days, setDays] = useState<number | null>(defaultDays);
  const [result, setResult] = useState('');
  const [recovered, setRecovered] = useState(false);
  const fixtureCount = recovered ? 128 : args.inboxCount;
  const [wakeAt, setWakeAt] = useState<string | null>(() =>
    args.verb === 'Later' ? defaultLaterWakeAtIso() : null,
  );
  const count =
    typeof fixtureCount === 'number'
      ? fixtureCount === 0
        ? 0
        : (pickBucketCount(batchCounts, days) ?? 0)
      : fixtureCount;
  return (
    <div style={{ maxWidth: 680, margin: '24px auto', padding: 16 }}>
      <p>
        {args.verb === 'Delete'
          ? 'Inline Delete layout preview · fictional mailbox. Delete still opens a confirmation window in the product.'
          : `Fictional mailbox · no Gmail changes. Triage inline ${args.verb} · Inbox only.`}
      </p>
      {result && <p role="status">{result}</p>}
      {open ? (
        <InlinePreviewBlock
          row={args.row ?? sampleRow}
          preview={{
            verb: args.verb,
            wakeAt,
            onWakeAtChange: setWakeAt,
            archiveHistoric: false,
            inboxCount: count,
            ageControl: { olderThanDays: days, options: TIME_WINDOW_PRESETS, onChange: setDays },
            onRetryPreview: () => setRecovered(true),
            onCancel: () => setOpen(false),
          }}
          busy={false}
          shortcutLive={false}
          onConfirm={() => {
            setResult(
              `Sample confirmation: ${args.verb} ${count} inbox emails, ${cleanupAgeLabel(days).toLowerCase()}${args.verb === 'Later' ? `; return ${wakeAt ? new Date(wakeAt).toLocaleString('en-US', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) : 'not selected'}` : ''}.`,
            );
            setOpen(false);
          }}
        />
      ) : (
        <Button
          onClick={() => {
            setDays(defaultDays);
            setWakeAt(args.verb === 'Later' ? defaultLaterWakeAtIso() : null);
            setOpen(true);
          }}
        >
          Review {args.verb}
        </Button>
      )}
    </div>
  );
}
export const ArchiveInline: Story = {
  args: { verb: 'Archive' },
  render: (args) => <InlineCleanupStory {...args} />,
};

export const DeleteInline: Story = {
  args: { verb: 'Delete' },
  render: (args) => <InlineCleanupStory {...args} />,
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
  olderThan365d: 0,
};
function BatchCleanupStory(args: ComponentProps<typeof ActionSheet>) {
  const [days, setDays] = useState<number | null>(null);
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState('');
  const [recovered, setRecovered] = useState(false);
  const fixtureCount = recovered ? 128 : args.inboxCount;
  const [wakeAt, setWakeAt] = useState<string | null>(() =>
    args.verb === 'Later' ? defaultLaterWakeAtIso() : null,
  );
  const preview =
    typeof fixtureCount === 'number'
      ? {
          senders: batchRows.map((row) => ({
            senderId: row.senderId,
            name: row.senderName,
            protected: false,
            counts: batchCounts,
          })),
          totals: Object.fromEntries(
            Object.entries(batchCounts).map(([key, value]) => [key, value * 2]),
          ) as typeof batchCounts,
          protectedCount: 0,
        }
      : fixtureCount;
  return (
    <div style={{ padding: 24 }}>
      <p>Fictional mailbox · no Gmail changes. Triage group {args.verb} · Inbox only · Any age.</p>
      <Button
        onClick={() => {
          setDays(null);
          setWakeAt(args.verb === 'Later' ? defaultLaterWakeAtIso() : null);
          setOpen(true);
        }}
      >
        Review {args.verb}
      </Button>
      {result && <p role="status">{result}</p>}
      <BatchActionSheet
        open={open}
        verb={args.verb === 'Later' ? 'Later' : 'Archive'}
        wakeAt={wakeAt}
        onWakeAtChange={setWakeAt}
        olderThanDays={days}
        onWindowChange={setDays}
        batch={batch}
        preview={preview}
        mailboxEmail="sample@example.com"
        onRetryPreview={() => setRecovered(true)}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setResult(
            `Sample confirmation: ${args.verb} ${(pickBucketCount(batchCounts, days) ?? 0) * 2} inbox emails, ${cleanupAgeLabel(days).toLowerCase()}${args.verb === 'Later' ? `; return ${wakeAt ? new Date(wakeAt).toLocaleString('en-US', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) : 'not selected'}` : ''}.`,
          );
          setOpen(false);
        }}
      />
    </div>
  );
}
export const ArchiveBatch: Story = {
  args: { verb: 'Archive' },
  render: (args) => <BatchCleanupStory {...args} />,
};

export const LaterDefault: Story = { args: { verb: 'Later' } };
export const LaterLoading: Story = { args: { verb: 'Later', inboxCount: 'loading' } };
export const LaterUnavailable: Story = { args: { verb: 'Later', inboxCount: 'unavailable' } };
export const LaterEmptyInbox: Story = { args: { verb: 'Later', inboxCount: 0 } };
export const LaterProtected: Story = {
  args: { verb: 'Later', row: { ...sampleRow, protectionReason: 'manual' } },
};
export const LaterInline: Story = {
  args: { verb: 'Later' },
  render: (args) => <InlineCleanupStory {...args} />,
};
export const LaterBatch: Story = {
  args: { verb: 'Later' },
  render: (args) => <BatchCleanupStory {...args} />,
};

export const ArchiveInlineUnavailable: Story = {
  args: { verb: 'Archive', inboxCount: 'unavailable' },
  render: (args) => <InlineCleanupStory {...args} />,
};
export const LaterInlineUnavailable: Story = {
  args: { verb: 'Later', inboxCount: 'unavailable' },
  render: (args) => <InlineCleanupStory {...args} />,
};
export const ArchiveBatchUnavailable: Story = {
  args: { verb: 'Archive', inboxCount: 'unavailable' },
  render: (args) => <BatchCleanupStory {...args} />,
};
export const LaterBatchUnavailable: Story = {
  args: { verb: 'Later', inboxCount: 'unavailable' },
  render: (args) => <BatchCleanupStory {...args} />,
};
