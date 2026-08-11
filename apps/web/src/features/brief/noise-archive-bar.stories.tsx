// Storybook CSF3 stories for the Noise archive bar (D65, D211, D210).
//
// This bar is where every terminal state of the archive comes to rest.
// A toast is gone in 3.6s; the line here persists, and it is what stops
// a partial failure from silently re-arming senders that already moved.
// So each outcome gets a story — including the ones nobody wants to see.
//
// Mirrors the local-shim pattern from sibling story files so this
// typechecks before the PR-3 Storybook seed merges (D210).

import { tokens } from '@declutrmail/shared';

import type { NoiseArchiveOutcome } from './api/use-noise-archive';
import { NoiseArchiveBar } from './brief-screen';

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

const noop = () => {};

function frame(props: {
  selectedCount?: number;
  excludedCount?: number;
  busy?: boolean;
  outcome?: NoiseArchiveOutcome | null;
}) {
  return (
    <div style={{ background: tokens.color.bg, padding: 16, maxWidth: 880 }}>
      <NoiseArchiveBar
        selectedCount={props.selectedCount ?? 4}
        excludedCount={props.excludedCount ?? 0}
        busy={props.busy ?? false}
        outcome={props.outcome ?? null}
        onArchive={noop}
      />
    </div>
  );
}

const meta: StoryMeta<typeof NoiseArchiveBar> = {
  title: 'Features/Brief/NoiseArchiveBar',
  component: NoiseArchiveBar,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "D65's bottom control. The button names the sender count, which the client knows exactly — the message count is deliberately absent, because the only truthful one comes from the server and arrives in the preview one click later. Every terminal state leaves a persistent line here rather than a toast that disappears.",
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Default — senders checked, nothing run yet. */
export const Ready: Story<typeof NoiseArchiveBar> = {
  render: () => frame({ selectedCount: 4 }),
};

/** Some senders cannot be included (Protected, or no longer resolvable). */
export const WithExclusions: Story<typeof NoiseArchiveBar> = {
  render: () => frame({ selectedCount: 4, excludedCount: 2 }),
};

/** Nothing checked — the invite changes rather than describing senders that aren't there. */
export const NothingChecked: Story<typeof NoiseArchiveBar> = {
  render: () => frame({ selectedCount: 0 }),
};

/** In flight — from confirm until the worker reaches a terminal state. */
export const Archiving: Story<typeof NoiseArchiveBar> = {
  render: () => frame({ selectedCount: 4, busy: true }),
};

/** Done, undo still open. The count is the worker's, not the preview's ask. */
export const Archived: Story<typeof NoiseArchiveBar> = {
  render: () =>
    frame({
      selectedCount: 0,
      outcome: { kind: 'archived', senderCount: 4, affectedCount: 348, undo: 'available' },
    }),
};

/** D211 "Undo expired" — the receipt stops offering an undo it cannot honour. */
export const ArchivedUndoExpired: Story<typeof NoiseArchiveBar> = {
  render: () =>
    frame({
      selectedCount: 0,
      outcome: { kind: 'archived', senderCount: 4, affectedCount: 348, undo: 'expired' },
    }),
};

/**
 * The archive was undone from the global tray. Derived from a server
 * read, so this state arrives on its own — the section never has to be
 * told by the tray.
 */
export const Reverted: Story<typeof NoiseArchiveBar> = {
  render: () => frame({ selectedCount: 4, outcome: { kind: 'reverted', senderCount: 4 } }),
};

/**
 * Partial failure. The aggregate cannot say which siblings failed, so no
 * row is marked Done and the selection is cleared — re-confirming would
 * spend another cleanup unit on senders that already archived.
 */
export const PartialFailure: Story<typeof NoiseArchiveBar> = {
  render: () =>
    frame({
      selectedCount: 0,
      outcome: { kind: 'partial', doneCount: 3, failedCount: 1, total: 4 },
    }),
};

/** Everything failed. Nothing moved, so the senders stay checked. */
export const Failed: Story<typeof NoiseArchiveBar> = {
  render: () => frame({ selectedCount: 4, outcome: { kind: 'failed' } }),
};

/** The status read failed — the outcome is genuinely unknown, and says so. */
export const Unconfirmed: Story<typeof NoiseArchiveBar> = {
  render: () => frame({ selectedCount: 0, outcome: { kind: 'unconfirmed' } }),
};
