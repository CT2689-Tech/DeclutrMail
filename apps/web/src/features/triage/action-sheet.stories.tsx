import { useState, type ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from '@declutrmail/shared';
import type { ActionReach } from '@declutrmail/shared/contracts';
import { ActionSheet } from './action-sheet';
import { TRIAGE_QUEUE } from './fixtures';

const sampleRow = {
  ...TRIAGE_QUEUE[0]!,
  senderName: 'Fieldnotes',
  senderEmail: 'weekly@fieldnotes.example',
  senderDomain: 'fieldnotes.example',
  brandMark: false,
};

function DeleteStory(args: ComponentProps<typeof ActionSheet>) {
  const [open, setOpen] = useState(args.open);
  const [reach, setReach] = useState<ActionReach>('inbox_only');
  const [result, setResult] = useState('');
  const inboxCount = typeof args.inboxCount === 'number' ? args.inboxCount : null;
  const allMailCount = inboxCount === null ? null : inboxCount + 18;
  const count = reach === 'all_mail' && allMailCount !== null ? allMailCount : args.inboxCount;
  return (
    <div style={{ padding: 24 }}>
      <p>Fictional mailbox · no Gmail changes. Triage keeps its Any age default.</p>
      <Button
        onClick={() => {
          setReach('inbox_only');
          setOpen(true);
        }}
      >
        Review Delete
      </Button>
      {result && <p role="status">{result}</p>}
      <ActionSheet
        {...args}
        open={open}
        reach={reach}
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
          setResult(`Sample confirmation: ${count} emails, ${reach}, any age.`);
          setOpen(false);
        }}
      />
    </div>
  );
}

const meta = {
  title: 'Triage/ActionSheet',
  component: ActionSheet,
  render: (args) => <DeleteStory {...args} />,
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
