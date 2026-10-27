import { useState, type ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { cleanupAgeLabel } from '@/components/cleanup-preview';
import { Button } from '@declutrmail/shared';
import type { ActionReach } from '@declutrmail/shared/contracts';
import { DEFAULT_DELETE_WINDOW_DAYS, defaultLaterWakeAtIso } from '@declutrmail/shared/actions';
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
  const [recovered, setRecovered] = useState(false);
  const isDelete = args.verb === 'delete';
  const defaultDays = isDelete ? DEFAULT_DELETE_WINDOW_DAYS : null;
  const [days, setDays] = useState<number | null>(defaultDays);
  const [reach, setReach] = useState<ActionReach>('inbox_only');
  const [result, setResult] = useState('');
  const [wakeAt, setWakeAt] = useState<string | null>(() =>
    args.verb === 'later' ? defaultLaterWakeAtIso() : null,
  );
  const bucket = (days ?? 'all') as keyof typeof inbox;
  const count = args.inboxCount === 0 ? 0 : inbox[bucket];
  const allMailCount = count + archived[bucket];
  return (
    <div style={{ maxWidth: 680, margin: '24px auto', padding: 16 }}>
      <p>
        Fictional mailbox · no Gmail changes. Screener{' '}
        {isDelete
          ? 'Delete starts at Any age'
          : args.verb === 'later'
            ? 'Later starts at Any age, with a return in 7 days'
            : 'Archive keeps Inbox only · Any age'}
        .
      </p>
      {result && <p role="status">{result}</p>}
      {open ? (
        <DecidePreview
          {...args}
          inboxCount={recovered || typeof args.inboxCount === 'number' ? count : args.inboxCount}
          inboxTotal={args.inboxCount === 0 ? 0 : inbox.all}
          allMailCount={recovered || typeof args.inboxCount === 'number' ? allMailCount : null}
          allMailTotal={inbox.all + archived.all}
          wakeAt={wakeAt}
          onWakeAtChange={setWakeAt}
          windowDays={days}
          reach={reach}
          onWindowChange={setDays}
          onReachChange={setReach}
          onCancel={() => setOpen(false)}
          onRetryPreview={() => setRecovered(true)}
          onConfirm={() => {
            setResult(
              `Sample confirmation: ${reach === 'all_mail' ? allMailCount : count} emails, ${reach === 'all_mail' ? 'inbox and archived' : 'inbox only'}, ${cleanupAgeLabel(days).toLowerCase()}${args.verb === 'later' ? `; return ${wakeAt ? new Date(wakeAt).toLocaleString('en-US', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) : 'not selected'}` : ''}.`,
            );
            setOpen(false);
          }}
        />
      ) : (
        <Button
          onClick={() => {
            setDays(defaultDays);
            setWakeAt(args.verb === 'later' ? defaultLaterWakeAtIso() : null);
            setReach('inbox_only');
            setOpen(true);
          }}
        >
          Review {isDelete ? 'Delete' : args.verb === 'later' ? 'Later' : 'Archive'}
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
function EmptySenderReview() {
  const [verb, setVerb] = useState<ComponentProps<typeof DecidePreview>['verb']>('delete');
  const [result, setResult] = useState('');
  return (
    <div style={{ maxWidth: 680, margin: '24px auto', padding: 16 }}>
      <p>Fictional sender · no current inbox or archived email. No Gmail changes.</p>
      {result ? (
        <p role="status">{result}</p>
      ) : (
        <DecidePreview
          verb={verb}
          row={sampleRow}
          inboxCount={0}
          inboxTotal={0}
          allMailCount={0}
          allMailTotal={0}
          confirming={false}
          mailboxEmail="sample@example.com"
          onChooseDecision={setVerb}
          onConfirm={() => setResult(`Sample confirmation: ${verb}`)}
          onCancel={() => setResult('Review cancelled')}
        />
      )}
    </div>
  );
}
export const NoCurrentEmail: Story = { render: () => <EmptySenderReview /> };
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

export const LaterDefault: Story = { args: { verb: 'later', inboxCount: 128 } };
export const LaterLoading: Story = { args: { verb: 'later', inboxCount: 'loading' } };
export const LaterUnavailable: Story = { args: { verb: 'later', inboxCount: 'unavailable' } };
export const LaterEmptyInbox: Story = { args: { verb: 'later', inboxCount: 0 } };
export const LaterProtected: Story = {
  args: {
    verb: 'later',
    row: { ...sampleRow, isProtected: true, protectionReason: 'user_defined' },
  },
};

function UnsubscribeStory(args: ComponentProps<typeof DecidePreview>) {
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState('');
  return (
    <div style={{ maxWidth: 680, padding: 24, margin: 'auto' }}>
      <p>Fictional mailbox · no Gmail changes. Screener Unsubscribe affects future email.</p>
      {open ? (
        <DecidePreview
          {...args}
          onCancel={() => {
            setResult('Preview canceled.');
            setOpen(false);
          }}
          onConfirm={() => {
            setResult(
              args.row.unsubscribeMethod === 'mailto'
                ? 'Sample confirmation: manual Gmail step; existing email stays where it is.'
                : 'Sample confirmation: unsubscribe request; existing email stays where it is.',
            );
            setOpen(false);
          }}
        />
      ) : (
        <>
          <p role="status">{result}</p>
          <Button onClick={() => setOpen(true)}>Review Unsubscribe</Button>
        </>
      )}
    </div>
  );
}
export const UnsubscribeDefault: Story = {
  args: { verb: 'unsubscribe', row: { ...sampleRow, unsubscribeMethod: 'one_click' } },
  render: (args) => <UnsubscribeStory {...args} />,
};
export const UnsubscribeMailto: Story = {
  ...UnsubscribeDefault,
  args: { verb: 'unsubscribe', row: { ...sampleRow, unsubscribeMethod: 'mailto' } },
};
