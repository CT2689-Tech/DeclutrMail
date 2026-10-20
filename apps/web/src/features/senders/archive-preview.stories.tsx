import { useState, type ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from '@declutrmail/shared';
import type { CompositeActionPreviewResult } from '@/lib/api/actions';
import { ConfirmActionModal } from './confirm-action-modal';
import { pickBucketCount } from './action-window';
import { makeSender } from './testing/make-sender';

const sender = makeSender({
  displayName: 'Fieldnotes',
  email: 'weekly@fieldnotes.example',
  domain: 'fieldnotes.example',
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
const recentMessages = {
  all: [],
  olderThan30d: [],
  olderThan90d: [],
  olderThan180d: [],
  olderThan365d: [],
};
const preview: CompositeActionPreviewResult = {
  sender: {
    id: sender.id,
    name: sender.name,
    domain: sender.domain,
    lastSeenDays: 2,
    wroteToCount: 0,
  },
  counts,
  recentMessages,
  allMail: { counts: { ...counts, all: 146 }, recentMessages },
  unsubAvailable: false,
  protected: false,
};

function ArchiveStory(args: ComponentProps<typeof ConfirmActionModal>) {
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState('');
  return (
    <div style={{ padding: 24 }}>
      <p>
        Fictional mailbox · no Gmail changes. Archive keeps its Inbox only and All time defaults.
      </p>
      <Button onClick={() => setOpen(true)}>Review Archive</Button>
      {result && <p role="status">{result}</p>}
      <ConfirmActionModal
        {...args}
        request={open ? args.request : null}
        onCancel={() => setOpen(false)}
        onConfirm={(options) => {
          const age = options.olderThanDays ?? null;
          const matched = pickBucketCount(args.compositePreview?.counts, age);
          setResult(
            `Sample confirmation: Archive ${matched ?? 'matching'} inbox emails, ${age === null ? 'any age' : `older than ${age} days`}.`,
          );
          setOpen(false);
        }}
      />
    </div>
  );
}

const meta = {
  title: 'Senders/ArchivePreview',
  component: ConfirmActionModal,
  render: (args) => <ArchiveStory {...args} />,
  args: {
    request: { verb: 'Archive', senders: [sender] },
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
export const Protected: Story = {
  args: {
    compositePreview: { ...preview, protected: true },
    request: {
      verb: 'Archive',
      senders: [
        {
          ...sender,
          protectionFlags: {
            isProtected: true,
            protectionReason: 'user_defined',
            protectionSetAt: '2026-10-01T00:00:00.000Z',
          },
        },
      ],
    },
  },
};
