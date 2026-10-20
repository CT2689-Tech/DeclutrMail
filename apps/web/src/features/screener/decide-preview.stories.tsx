import { useState, type ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { cleanupAgeLabel } from '@/components/cleanup-preview';
import { Button } from '@declutrmail/shared';
import type { ActionReach } from '@declutrmail/shared/contracts';
import { DEFAULT_DELETE_WINDOW_DAYS } from '@declutrmail/shared/actions';
import { SCREENER_QUEUE } from './data';
import { DecidePreview } from './decide-preview';

const inbox = { all: 128, 30: 120, 90: 104, 180: 84, 365: 0 };
const archived = { all: 18, 30: 18, 90: 16, 180: 12, 365: 6 };
const sampleRow = {
  ...SCREENER_QUEUE[0]!,
  senderName: 'Fieldnotes',
  senderEmail: 'weekly@fieldnotes.example',
  senderDomain: 'fieldnotes.example',
  brandMark: false,
};

function CleanupStory(args: ComponentProps<typeof DecidePreview>) {
  const [open, setOpen] = useState(true);
  const isDelete = args.verb === 'delete';
  const defaultDays = isDelete ? DEFAULT_DELETE_WINDOW_DAYS : null;
  const [days, setDays] = useState<number | null>(defaultDays);
  const [reach, setReach] = useState<ActionReach>('inbox_only');
  const [result, setResult] = useState('');
  const bucket = (days ?? 'all') as keyof typeof inbox;
  const count = args.inboxCount === 0 ? 0 : inbox[bucket];
  const allMailCount = count + archived[bucket];
  return (
    <div style={{ maxWidth: 680, margin: '24px auto', padding: 16 }}>
      <p>
        Fictional mailbox · no Gmail changes. Screener{' '}
        {isDelete ? 'Delete keeps its 180-day default' : 'Archive keeps Inbox only · Any age'}.
      </p>
      {result && <p role="status">{result}</p>}
      {open ? (
        <DecidePreview
          {...args}
          inboxCount={typeof args.inboxCount === 'number' ? count : args.inboxCount}
          inboxTotal={args.inboxCount === 0 ? 0 : inbox.all}
          allMailCount={typeof args.inboxCount === 'number' ? allMailCount : null}
          allMailTotal={inbox.all + archived.all}
          windowDays={days}
          reach={reach}
          onWindowChange={setDays}
          onReachChange={setReach}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setResult(
              `Sample confirmation: ${reach === 'all_mail' ? allMailCount : count} emails, ${reach}, ${cleanupAgeLabel(days).toLowerCase()}.`,
            );
            setOpen(false);
          }}
        />
      ) : (
        <Button
          onClick={() => {
            setDays(defaultDays);
            setReach('inbox_only');
            setOpen(true);
          }}
        >
          Review {isDelete ? 'Delete' : 'Archive'}
        </Button>
      )}
    </div>
  );
}

const meta = {
  title: 'Screener/DecidePreview',
  component: DecidePreview,
  render: (args) => <CleanupStory {...args} />,
  args: {
    verb: 'delete',
    row: sampleRow,
    inboxCount: 84,
    confirming: false,
    mailboxEmail: 'sample@example.com',
    onConfirm: () => undefined,
    onCancel: () => undefined,
  },
} satisfies Meta<typeof DecidePreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const DeleteDefault: Story = {};
export const DeleteLoading: Story = { args: { inboxCount: 'loading' } };
export const DeleteUnavailable: Story = { args: { inboxCount: 'unavailable' } };
export const DeleteEmptyAge: Story = { args: { inboxCount: 0 } };
export const DeleteProtected: Story = {
  args: { row: { ...sampleRow, isProtected: true, protectionReason: 'user_defined' } },
};

export const ArchiveDefault: Story = { args: { verb: 'archive', inboxCount: 128 } };
export const ArchiveLoading: Story = { args: { verb: 'archive', inboxCount: 'loading' } };
export const ArchiveUnavailable: Story = { args: { verb: 'archive', inboxCount: 'unavailable' } };
export const ArchiveEmptyInbox: Story = { args: { verb: 'archive', inboxCount: 0 } };
export const ArchiveProtected: Story = {
  args: {
    verb: 'archive',
    row: { ...sampleRow, isProtected: true, protectionReason: 'user_defined' },
  },
};
