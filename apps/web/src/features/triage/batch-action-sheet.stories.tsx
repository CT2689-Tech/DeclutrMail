// Storybook CSF3 stories for the Triage batch action sheet (D37, D226,
// D52, ADR-0020).
//
// Storybook itself is seeded in PR 3 (D210). Until the seed lands, this
// file uses the same lightweight local CSF shims as
// `triage-screen.stories.tsx` so it typechecks without
// `@storybook/react` installed.
//
// This is the D226-MANDATORY preview for a domain-batch decision: the
// AGGREGATED count that will actually move, a per-sender breakdown, and
// the protected senders the enqueue skips — all BE-real (no client
// estimate). Confirm fires ONE composite POST with the senders selector
// (ADR-0020) → one batch, one cascade undo token.
//
// Variants cover the four D211 preview states + both verbs:
//   • ArchiveLoaded  — aggregated Archive preview, per-sender rows
//   • LaterLoaded    — the Later verb copy
//   • WithProtected  — a protected sender shown "protected — skipped"
//   • Loading        — "Counting the inbox…" while the preview resolves
//   • Unavailable    — preview failed; "nothing changes until you confirm"
//   • NothingToMove  — zero real count ("nothing to move")

import { tokens } from '@declutrmail/shared';
import type { BulkActionPreviewResult } from '@/lib/api/use-action';
import { TRIAGE_QUEUE, type TriageDecisionRow } from './data';
import { BatchActionSheet } from './batch-action-sheet';
import type { DomainBatch } from './domain-batch';

const { color } = tokens;

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

const meta: StoryMeta<typeof BatchActionSheet> = {
  title: 'Triage/BatchActionSheet',
  component: BatchActionSheet,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The D226-mandatory preview for a domain-batch decision. Mirrors `<ActionSheet>`’s chrome + keyboard contract (Escape cancels, ⌘⏎ confirms) over the AGGREGATED bulk preview: the real total that moves, the per-sender breakdown, and the protected senders the enqueue skips. Confirm fires ONE composite POST (ADR-0020) — one batch, one cascade undo. No remember-preference toggle: a multi-sender batch always shows its sheet.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type Args = Parameters<typeof BatchActionSheet>[0];

/** Fabricate a same-domain batch from the shared fixture rows. */
function mkBatch(
  domain: string,
  members: { name: string; protection?: TriageDecisionRow['protectionReason'] }[],
): DomainBatch {
  const base = TRIAGE_QUEUE[0]!;
  const rows: TriageDecisionRow[] = members.map((m, i) => ({
    ...base,
    id: `batch-${domain}-${i}`,
    senderId: `sid-${domain}-${i}`,
    senderKey: `sk_${domain}_${i}`,
    senderName: m.name,
    senderEmail: `${m.name.toLowerCase().replace(/\s+/g, '.')}@${domain}`,
    senderDomain: domain,
    verdict: m.protection ? 'keep' : 'archive',
    protectionReason: m.protection ?? null,
  }));
  return { domain, startIndex: 0, rows };
}

const AMAZON_BATCH = mkBatch('amazon.com', [
  { name: 'Amazon Orders' },
  { name: 'Amazon Prime' },
  { name: 'Amazon Deals' },
]);

const EMPTY_BUCKETS = {
  all: 0,
  olderThan30d: 0,
  olderThan90d: 0,
  olderThan180d: 0,
  olderThan365d: 0,
};

/** Build a preview payload whose per-sender counts sum to the total. */
function preview(
  batch: DomainBatch,
  perSender: number[],
  protectedIdx: number[] = [],
): BulkActionPreviewResult {
  const senders = batch.rows.map((r, i) => ({
    senderId: r.senderId,
    name: r.senderName,
    counts: { ...EMPTY_BUCKETS, all: perSender[i] ?? 0 },
    protected: protectedIdx.includes(i),
  }));
  const total = senders.filter((s) => !s.protected).reduce((sum, s) => sum + s.counts.all, 0);
  return {
    senders,
    totals: { ...EMPTY_BUCKETS, all: total },
    protectedCount: protectedIdx.length,
  };
}

function frame(children: React.ReactNode) {
  return (
    <div style={{ background: color.bg, minHeight: '100vh', position: 'relative' }}>{children}</div>
  );
}

/** Archive — aggregated preview with a per-sender breakdown. */
export const ArchiveLoaded: Story<typeof BatchActionSheet> = {
  args: {
    open: true,
    verb: 'Archive',
    batch: AMAZON_BATCH,
    preview: preview(AMAZON_BATCH, [156, 92, 40]),
    onCancel: () => {},
    onConfirm: () => {},
  },
  render: (args: Args) => frame(<BatchActionSheet {...args} />),
};

/** Later — same sheet, the Later verb copy + primary button. */
export const LaterLoaded: Story<typeof BatchActionSheet> = {
  args: {
    open: true,
    verb: 'Later',
    batch: AMAZON_BATCH,
    preview: preview(AMAZON_BATCH, [156, 92, 40]),
    onCancel: () => {},
    onConfirm: () => {},
  },
  render: (args: Args) => frame(<BatchActionSheet {...args} />),
};

/** With a protected member — shown "protected — skipped", excluded from totals. */
export const WithProtected: Story<typeof BatchActionSheet> = {
  args: {
    open: true,
    verb: 'Archive',
    batch: mkBatch('substack.com', [
      { name: 'Money Stuff' },
      { name: 'Stratechery', protection: 'vip' },
      { name: 'Lenny’s Newsletter' },
    ]),
    preview: (() => {
      const b = mkBatch('substack.com', [
        { name: 'Money Stuff' },
        { name: 'Stratechery', protection: 'vip' },
        { name: 'Lenny’s Newsletter' },
      ]);
      return preview(b, [64, 0, 22], [1]);
    })(),
    onCancel: () => {},
    onConfirm: () => {},
  },
  render: (args: Args) => frame(<BatchActionSheet {...args} />),
};

/** Loading — "Counting the inbox…" while the preview resolves. */
export const Loading: Story<typeof BatchActionSheet> = {
  args: {
    open: true,
    verb: 'Archive',
    batch: AMAZON_BATCH,
    preview: 'loading',
    onCancel: () => {},
    onConfirm: () => {},
  },
  render: (args: Args) => frame(<BatchActionSheet {...args} />),
};

/** Unavailable — the preview failed; the copy says nothing changes yet. */
export const Unavailable: Story<typeof BatchActionSheet> = {
  args: {
    open: true,
    verb: 'Archive',
    batch: AMAZON_BATCH,
    preview: 'unavailable',
    onCancel: () => {},
    onConfirm: () => {},
  },
  render: (args: Args) => frame(<BatchActionSheet {...args} />),
};

/** Nothing to move — a real zero count ("nothing to move."). */
export const NothingToMove: Story<typeof BatchActionSheet> = {
  args: {
    open: true,
    verb: 'Archive',
    batch: AMAZON_BATCH,
    preview: preview(AMAZON_BATCH, [0, 0, 0]),
    onCancel: () => {},
    onConfirm: () => {},
  },
  render: (args: Args) => frame(<BatchActionSheet {...args} />),
};
