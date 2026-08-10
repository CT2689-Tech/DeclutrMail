// Storybook CSF3 stories for the Protected-action notice (D245, D226).
//
// Real `Meta` / `StoryObj` types — the local `Partial<…>` shim erased
// required-prop checking, which is how the (required) `surface` prop
// could be missing from every story without a squeak from tsc.
//
// What these variants exist to show is a CLAIM, not a layout: acting on
// a Protected sender leaves the protection intact, so every future bulk
// run and Autopilot pass keeps skipping that sender while the action
// the user just took felt finished. The notice says so, and offers the
// separate Unprotect control beside it — the two acts stay separate
// because bundling them has no undo kind (`undo_action_kind` carries no
// protection variant) and would forge a D245 sticky override.
//
// The `verb` axis has exactly one branch: Unsubscribe stops FUTURE
// mail, so what stays shielded is whatever still arrives. The notice
// deliberately says nothing else about what a verb reaches —
// `ActionPreviewPresentation` owns that, and a second description of
// the same fact is how Delete's copy came to omit Gmail Trash.

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tokens } from '@declutrmail/shared';
import { TRIAGE_QUEUE, type TriageDecisionRow } from './data';
import { ProtectedActionNotice, UnprotectButton } from './protected-notice';

const { color } = tokens;

const meta: Meta<typeof ProtectedActionNotice> = {
  title: 'Triage/ProtectedActionNotice',
  component: ProtectedActionNotice,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Stated inside the mandatory D226 preview on BOTH paths — the modal sheet and the inline preview D34’s remember-preference falls back to. A notice present on only one of them is a notice the user can skip.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ProtectedActionNotice>;

/** The Unprotect control issues a real mutation, so it needs a client. */
function frame(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <div style={{ background: color.bg, padding: 32, width: 520 }}>{children}</div>
    </QueryClientProvider>
  );
}

function protectedRow(reason: NonNullable<TriageDecisionRow['protectionReason']>) {
  const row = TRIAGE_QUEUE.find((r) => r.id === 't-groupon');
  if (!row) throw new Error('fixture missing t-groupon');
  return { ...row, protectionReason: reason };
}

/**
 * The default: a mail-moving verb on a Protected sender. The action is
 * allowed (D245 scopes protection to BULK and AUTOMATIC actions), the
 * shield survives it, and the user is told.
 */
export const OnArchive: Story = {
  args: { row: protectedRow('starred'), verb: 'Archive', surface: 'triage-preview' },
  render: (args) => frame(<ProtectedActionNotice {...args} />),
};

/**
 * Delete reads identically. It used to be the one that drifted: an
 * earlier draft opened with a hand-rolled "Delete moves matching inbox
 * mail now", which omitted Gmail Trash while the canonical preview
 * above it named it.
 */
export const OnDelete: Story = {
  args: { row: protectedRow('gmail-important'), verb: 'Delete', surface: 'triage-preview' },
  render: (args) => frame(<ProtectedActionNotice {...args} />),
};

/**
 * The partial case. Unsubscribe stops future delivery rather than
 * moving the existing backlog, so the protection keeps shielding
 * *whatever still arrives*.
 */
export const OnUnsubscribe: Story = {
  args: { row: protectedRow('replied'), verb: 'Unsubscribe', surface: 'triage-preview' },
  render: (args) => frame(<ProtectedActionNotice {...args} />),
};

/**
 * No pending verb — the surface has nothing to contrast against, so the
 * notice states the standing consequence alone.
 */
export const WithoutAVerb: Story = {
  args: { row: protectedRow('manual'), verb: null, surface: 'triage-preview' },
  render: (args) => frame(<ProtectedActionNotice {...args} />),
};

/**
 * The DISABLED / two-sided case: an unprotected row renders nothing at
 * all. A notice only ever seen present is not a verified notice.
 */
export const UnprotectedRowRendersNothing: Story = {
  args: {
    row: TRIAGE_QUEUE.find((r) => r.protectionReason === null)!,
    verb: 'Archive',
    surface: 'triage-preview',
  },
  render: (args) =>
    frame(
      <>
        <ProtectedActionNotice {...args} />
        <p style={{ color: color.fgMuted, fontSize: 12, margin: 0 }}>
          (nothing renders above this line — the row is not Protected)
        </p>
      </>,
    ),
};

/**
 * The control on its own, as the D245 protection review renders it in a
 * row strip. Nothing moves, and there is no undo window — but it is not
 * freely reversible either: a manual Unprotect is a STICKY override, so
 * automatic protection will not put the shield back.
 */
export const UnprotectControlAlone: StoryObj<typeof UnprotectButton> = {
  args: { row: protectedRow('starred'), surface: 'onboarding-review' },
  render: (args) => frame(<UnprotectButton {...args} />),
};
