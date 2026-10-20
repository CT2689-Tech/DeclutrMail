import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from '@declutrmail/shared';
import { cleanupAgeLabel, type UnsubscribeCleanupMode } from '@/components/cleanup-preview';
import { pickBucketCount, TIME_WINDOW_PRESETS } from '@/features/senders/action-window';
import { ActionSheet, type ConfirmDetails } from './action-sheet';
import { InlinePreviewBlock } from './inline-preview';
import { TRIAGE_QUEUE } from './fixtures';

const row = {
  ...TRIAGE_QUEUE[1]!,
  senderName: 'Fieldnotes',
  senderEmail: 'weekly@fieldnotes.example',
  senderDomain: 'fieldnotes.example',
  brandMark: false,
  protectionReason: null,
  unsubscribeMethod: 'one_click' as const,
};
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
function Story({
  inline = false,
  state = 'ready',
}: {
  inline?: boolean;
  state?: 'ready' | 'loading' | 'unavailable';
}) {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<UnsubscribeCleanupMode>('archive');
  const [days, setDays] = useState<number | null>(null);
  const [reach, setReach] = useState<'inbox_only' | 'all_mail'>('inbox_only');
  const [result, setResult] = useState('');
  const count =
    state === 'ready'
      ? pickBucketCount(mode === 'delete' && reach === 'all_mail' ? allCounts : counts, days)!
      : state;
  const onMode = (next: UnsubscribeCleanupMode) => {
    setMode(next);
    setDays(next === 'delete' ? 180 : null);
    setReach('inbox_only');
  };
  const ageControl = { olderThanDays: days, options: TIME_WINDOW_PRESETS, onChange: setDays };
  const confirm = (details: ConfirmDetails) => {
    const nextMode = details.backlogMode ?? 'unsub_only';
    const age = details.olderThanDays ?? null;
    const all = details.reach === 'all_mail';
    setResult(
      `Sample confirmation: unsubscribe; ${nextMode === 'unsub_only' ? 'existing email stays' : `${nextMode} ${pickBucketCount(all ? allCounts : counts, age)} emails, ${all ? 'inbox and archived' : 'inbox only'}, ${cleanupAgeLabel(age).toLowerCase()}`}.`,
    );
    setOpen(false);
  };
  return (
    <div style={{ maxWidth: 680, padding: 24, margin: 'auto' }}>
      <p>
        Fictional mailbox · no Gmail changes. Triage Unsubscribe {inline ? 'inline' : 'dialog'}.
      </p>
      {result && <p role="status">{result}</p>}
      {!open && (
        <Button
          onClick={() => {
            onMode('archive');
            setOpen(true);
          }}
        >
          Review Unsubscribe
        </Button>
      )}
      {open &&
        (inline ? (
          <InlinePreviewBlock
            row={row}
            preview={{
              verb: 'Unsubscribe',
              archiveHistoric: mode === 'archive',
              backlogMode: mode,
              onBacklogMode: onMode,
              ageControl: mode !== 'unsub_only' ? ageControl : undefined,
              inboxCount: count,
              onCancel: () => setOpen(false),
            }}
            busy={false}
            shortcutLive={false}
            accountContext={<span>Gmail account: sample@example.com</span>}
            onConfirm={() =>
              confirm({
                backlogMode: mode,
                archiveHistoric: mode === 'archive',
                olderThanDays: days,
                rememberPreference: true,
                wakeAt: null,
              })
            }
          />
        ) : (
          <ActionSheet
            open
            verb="Unsubscribe"
            row={row}
            inboxCount={count}
            mailboxEmail="sample@example.com"
            reach={reach}
            onReachChange={setReach}
            onBacklogModeChange={onMode}
            detail={{
              inboxTotal: counts.all,
              ageControl,
              reachControl: {
                reach,
                inboxCount: state === 'ready' ? pickBucketCount(counts, days)! : null,
                allMailCount: state === 'ready' ? pickBucketCount(allCounts, days)! : null,
                onChange: setReach,
              },
            }}
            onCancel={() => setOpen(false)}
            onConfirm={confirm}
          />
        ))}
    </div>
  );
}
const meta = { title: 'Triage/UnsubscribePreview', component: Story, args: {} } satisfies Meta<
  typeof Story
>;
export default meta;
type StoryType = StoryObj<typeof meta>;
export const Default: StoryType = {};
export const Inline: StoryType = { args: { inline: true } };
export const Loading: StoryType = { args: { state: 'loading' } };
export const Unavailable: StoryType = { args: { state: 'unavailable' } };
