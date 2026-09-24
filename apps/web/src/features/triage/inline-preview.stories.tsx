// Storybook CSF3 stories for the D34 inline preview — the mandatory D226
// preview rendered in place (list row or focus card) when the sheet is
// skipped.
//
// Same lightweight local CSF shims as `focus-card.stories.tsx`.
//
// Variants:
//   • Archive / Later / Delete — the mail-moving verbs, count resolved
//   • Unsubscribe              — cuts future email; no inbox count needed
//   • UnsubscribeAndArchive    — also archives what is already there
//   • CountLoading             — fails closed until the live count lands
//   • NothingToActOn           — a zero count cannot be confirmed
//   • Protected                — the override is named: "Confirm … anyway"
//
// Keep is absent: it moves no email and never opens a preview (D40).

import { tokens } from '@declutrmail/shared';
import { TRIAGE_QUEUE, type TriageDecisionRow } from './data';
import { InlinePreviewBlock, type InlinePreview } from './inline-preview';

const { color } = tokens;

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story = { render: () => React.ReactElement };

const meta: StoryMeta<typeof InlinePreviewBlock> = {
  title: 'Triage/InlinePreview',
  component: InlinePreviewBlock,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The preview that renders when the action sheet is skipped (D34). Always shown while an action is pending — never behind a disclosure — with an explicit Confirm that stays disabled until the live count resolves.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

function row(id: string): TriageDecisionRow {
  const found = TRIAGE_QUEUE.find((r) => r.id === id);
  if (!found) throw new Error(`fixture missing row ${id}`);
  return found;
}

function Preview({
  rowId = 't-groupon',
  preview,
}: {
  rowId?: string;
  preview: Omit<InlinePreview, 'archiveHistoric' | 'inboxCount'> &
    Partial<Pick<InlinePreview, 'archiveHistoric' | 'inboxCount'>>;
}) {
  return (
    <div style={{ background: color.bg, padding: 24, width: 560 }}>
      <InlinePreviewBlock
        row={row(rowId)}
        preview={{ archiveHistoric: false, inboxCount: 47, ...preview }}
        busy={false}
        shortcutLive
        onConfirm={() => undefined}
      />
    </div>
  );
}

export const Archive: Story = { render: () => <Preview preview={{ verb: 'Archive' }} /> };

export const Unsubscribe: Story = {
  render: () => <Preview rowId="t-linkedin" preview={{ verb: 'Unsubscribe' }} />,
};

export const UnsubscribeAndArchive: Story = {
  render: () => (
    <Preview rowId="t-linkedin" preview={{ verb: 'Unsubscribe', archiveHistoric: true }} />
  ),
};

export const Later: Story = {
  render: () => <Preview preview={{ verb: 'Later', wakeAt: '2026-10-01T09:00:00.000Z' }} />,
};

export const Delete: Story = { render: () => <Preview preview={{ verb: 'Delete' }} /> };

export const CountLoading: Story = {
  render: () => <Preview preview={{ verb: 'Archive', inboxCount: 'loading' }} />,
};

export const NothingToActOn: Story = {
  render: () => <Preview preview={{ verb: 'Archive', inboxCount: 0 }} />,
};

export const Protected: Story = {
  render: () => <Preview rowId="t-sarah" preview={{ verb: 'Archive' }} />,
};
