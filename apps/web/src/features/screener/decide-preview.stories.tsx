import { useState, type ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from '@declutrmail/shared';
import type { ActionReach } from '@declutrmail/shared/contracts';
import { DEFAULT_DELETE_WINDOW_DAYS } from '@declutrmail/shared/actions';
import { SCREENER_QUEUE } from './data';
import { DecidePreview } from './decide-preview';

const inbox = { all: 128, 30: 120, 90: 104, 180: 84, 365: 24 };
const archived = { all: 18, 30: 18, 90: 16, 180: 12, 365: 6 };
const sampleRow = {
  ...SCREENER_QUEUE[0]!,
  senderName: 'Fieldnotes',
  senderEmail: 'weekly@fieldnotes.example',
  senderDomain: 'fieldnotes.example',
  brandMark: false,
};

function DeleteStory(args: ComponentProps<typeof DecidePreview>) {
  const [open, setOpen] = useState(true);
  const [days, setDays] = useState<number | null>(DEFAULT_DELETE_WINDOW_DAYS);
  const [reach, setReach] = useState<ActionReach>('inbox_only');
  const [result, setResult] = useState('');
  const bucket = (days ?? 'all') as keyof typeof inbox;
  const count = args.inboxCount === 0 ? 0 : inbox[bucket];
  const allMailCount = count + archived[bucket];
  return (
    <div style={{ maxWidth: 680, margin: '24px auto', padding: 16 }}>
      <p>Fictional mailbox · no Gmail changes. Screener keeps its 180-day default.</p>
      {result && <p role="status">{result}</p>}
      {open ? (
        <DecidePreview
          {...args}
          inboxCount={typeof args.inboxCount === 'number' ? count : args.inboxCount}
          inboxTotal={inbox.all}
          allMailCount={typeof args.inboxCount === 'number' ? allMailCount : null}
          allMailTotal={inbox.all + archived.all}
          windowDays={days}
          reach={reach}
          onWindowChange={setDays}
          onReachChange={setReach}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setResult(
              `Sample confirmation: ${reach === 'all_mail' ? allMailCount : count} emails, ${reach}, ${days ?? 'any age'}.`,
            );
            setOpen(false);
          }}
        />
      ) : (
        <Button
          onClick={() => {
            setDays(DEFAULT_DELETE_WINDOW_DAYS);
            setReach('inbox_only');
            setOpen(true);
          }}
        >
          Review Delete
        </Button>
      )}
    </div>
  );
}

const meta = {
  title: 'Screener/DecidePreview',
  component: DecidePreview,
  render: (args) => <DeleteStory {...args} />,
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
