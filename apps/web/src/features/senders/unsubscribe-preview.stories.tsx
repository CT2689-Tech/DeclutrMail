import { useState, type ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from '@declutrmail/shared';
import { cleanupAgeLabel } from '@/components/cleanup-preview';
import { ConfirmActionModal } from './confirm-action-modal';
import { pickBucketCount, sumBucketCounts } from './action-window';
import { makeSender } from './testing/make-sender';

const sender = makeSender({
  displayName: 'Fieldnotes',
  email: 'weekly@fieldnotes.example',
  domain: 'fieldnotes.example',
  unsubscribeMethod: 'one_click',
  inboxCount: 128,
  totalReceived: 146,
});
const counts = {
  all: 128,
  olderThan30d: 120,
  olderThan90d: 104,
  olderThan180d: 84,
  olderThan365d: 0,
};
const allCounts = {
  all: 146,
  olderThan30d: 138,
  olderThan90d: 120,
  olderThan180d: 96,
  olderThan365d: 6,
};
const recentMessages = {
  all: [],
  olderThan30d: [],
  olderThan90d: [],
  olderThan180d: [],
  olderThan365d: [],
};
const preview = {
  sender: {
    id: sender.id,
    name: sender.name,
    domain: sender.domain,
    lastSeenDays: 2,
    wroteToCount: 0,
  },
  counts,
  recentMessages,
  allMail: { counts: allCounts, recentMessages },
  unsubAvailable: true,
  protected: false,
};
function UnsubscribeStory(args: ComponentProps<typeof ConfirmActionModal>) {
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState('');
  return (
    <div style={{ padding: 24 }}>
      <p>Fictional mailbox · no Gmail changes. Archive and Delete start at Any age.</p>
      <Button onClick={() => setOpen(true)}>Review Unsubscribe</Button>
      {result && <p role="status">{result}</p>}
      <ConfirmActionModal
        {...args}
        request={open ? args.request : null}
        onCancel={() => setOpen(false)}
        onConfirm={(options) => {
          const mode = options.secondary?.type ?? 'unsub_only';
          const age = options.secondary?.olderThanDays ?? null;
          const all = options.reach === 'all_mail';
          const rows = args.bulkPreview?.data?.senders.filter(
            (row) => !row.protected && options.senderIds?.includes(row.senderId),
          );
          const count = rows
            ? sumBucketCounts(
                rows.map((row) => (all ? row.allMailCounts : row.counts)),
                age,
              )
            : pickBucketCount(
                all ? args.compositePreview?.allMail?.counts : args.compositePreview?.counts,
                age,
              );
          setResult(
            `Sample confirmation: ${options.senderIds?.length} unsubscribe target(s); ${mode === 'unsub_only' ? 'existing email stays' : `${mode} ${count ?? 'matching'} emails, ${all ? 'inbox and archived' : 'inbox only'}, ${cleanupAgeLabel(age).toLowerCase()}`}.`,
          );
          setOpen(false);
        }}
      />
    </div>
  );
}
const meta = {
  title: 'Senders/UnsubscribePreview',
  component: ConfirmActionModal,
  render: (args) => <UnsubscribeStory {...args} />,
  args: {
    request: { verb: 'Unsubscribe', senders: [sender] },
    compositePreview: preview,
    mailboxEmail: 'sample@example.com',
    onCancel: () => undefined,
    onConfirm: () => undefined,
  },
} satisfies Meta<typeof ConfirmActionModal>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Loading: Story = { args: { compositePreviewLoading: true } };
export const Unavailable: Story = {
  args: { compositePreviewError: true, onRetryPreview: () => undefined },
};
export const EmptyInbox: Story = {
  args: {
    compositePreview: {
      ...preview,
      counts: { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
    },
  },
};
export const Mailto: Story = {
  args: { request: { verb: 'Unsubscribe', senders: [{ ...sender, unsubscribeMethod: 'mailto' }] } },
};
const second = {
  ...sender,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Fieldnotes Events',
  email: 'events@fieldnotes.example',
};
export const Group: Story = {
  args: {
    request: { verb: 'Unsubscribe', senders: [sender, second] },
    compositePreview: undefined,
    bulkPreview: {
      loading: false,
      error: false,
      data: {
        totals: {
          all: 256,
          olderThan30d: 240,
          olderThan90d: 208,
          olderThan180d: 168,
          olderThan365d: 0,
        },
        protectedCount: 0,
        senders: [sender, second].map((row) => ({
          senderId: row.id,
          name: row.name,
          protected: false,
          counts,
          allMailCounts: allCounts,
        })),
      },
    },
  },
};
export const Protected: Story = {
  args: {
    request: {
      verb: 'Unsubscribe',
      senders: [
        {
          ...sender,
          protectionFlags: {
            isProtected: true,
            protectionReason: 'user_defined',
            protectionSetAt: '2026-10-01T00:00:00Z',
          },
        },
      ],
    },
    compositePreview: { ...preview, protected: true },
  },
};
