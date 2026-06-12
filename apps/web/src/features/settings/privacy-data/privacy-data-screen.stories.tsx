// Storybook CSF3 stories for the Privacy & Data sub-page (U23 —
// D116/D217/D228). Stories mount the dumb `PrivacyDataView` so no
// auth/query shims are needed (same stance as the Snoozed screen).
//
// Variants covered:
//   • TwoMailboxes   — both accounts indexed, Pro undo window
//   • TierUnknown    — billing unavailable; generic undo copy
//   • Exporting      — JSON download in flight
//   • ExportFailed   — export error alert (rate-limit / stream failure)
//   • NoMailboxes    — zero indexed mailboxes (empty state)

import type { ComponentProps } from 'react';
import { PrivacyDataView } from './privacy-data-screen';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  parameters?: Record<string, unknown>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

const meta: StoryMeta<typeof PrivacyDataView> = {
  title: 'Settings/PrivacyData',
  component: PrivacyDataView,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Settings → Privacy & Data (D116/D217/D228). The dedicated trust sub-page: the locked D228 PrivacyBadge ("Full bodies fetched: 0" + explicit storage list), indexed mailboxes, undo retention, the DPDP data export (JSON/CSV — allowlisted columns only, never bodies), leave-cleanly pointers, and the CASA evidence row.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type ViewArgs = ComponentProps<typeof PrivacyDataView>;

const noop = () => undefined;

const MAILBOX_A = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'chintan.a.thakkar@gmail.com',
  status: 'active' as const,
  connectedAt: '2026-05-01T00:00:00.000Z',
  readiness: 'ready' as const,
};

const MAILBOX_B = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'chintan.a.thakkar.crypt@gmail.com',
  status: 'active' as const,
  connectedAt: '2026-06-01T00:00:00.000Z',
  readiness: 'ready' as const,
};

const baseArgs: ViewArgs = {
  mailboxes: [MAILBOX_A, MAILBOX_B],
  undoDays: 30,
  exportPendingFormat: null,
  exportFailed: false,
  onExport: noop,
};

export const TwoMailboxes: Story<typeof PrivacyDataView> = {
  args: baseArgs,
};

export const TierUnknown: Story<typeof PrivacyDataView> = {
  args: { ...baseArgs, undoDays: null },
};

export const Exporting: Story<typeof PrivacyDataView> = {
  args: { ...baseArgs, exportPendingFormat: 'json' },
};

export const ExportFailed: Story<typeof PrivacyDataView> = {
  args: { ...baseArgs, exportFailed: true },
};

export const NoMailboxes: Story<typeof PrivacyDataView> = {
  args: { ...baseArgs, mailboxes: [] },
};
