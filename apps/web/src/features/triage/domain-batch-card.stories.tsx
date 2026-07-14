// Storybook CSF3 stories for the Triage domain-batch card (D37, D32,
// D222, D226).
//
// Storybook itself is seeded in PR 3 (D210). Until the seed lands, this
// file uses the same lightweight local CSF shims as
// `triage-screen.stories.tsx` so it typechecks without
// `@storybook/react` installed.
//
// The card is the ONE scoped exception to D32's "no bulk in Triage":
// when ≥3 CONSECUTIVE rows share a registrable DOMAIN (D222 — literal
// sender domain, never a predicted category), the run collapses into a
// single "decide together?" card. A verb routes through the same
// D226-mandatory preview → mutation path as every destructive action.
//
// Variants:
//   • Default        — 4 same-domain senders, all eligible
//   • WithProtected  — one member is protected → stays untouched
//   • Busy           — this batch's decision is confirming server-side
//   • Disabled       — another decision is confirming (single-slot latch)
//   • MinimumRun     — the 3-row floor (`MIN_BATCH_RUN`)

import { tokens } from '@declutrmail/shared';
import { TRIAGE_QUEUE, type TriageDecisionRow } from './data';
import { DomainBatchCard } from './domain-batch-card';
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

const meta: StoryMeta<typeof DomainBatchCard> = {
  title: 'Triage/DomainBatchCard',
  component: DomainBatchCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Domain-batch card — "{n} senders from {domain} — decide together?". Offered when ≥3 consecutive rows share a registrable domain (D222 — literal domain grouping, never a predicted category). Strictly additive: "Decide one by one" dismisses it back to normal rows. Archive/Later route through the D226-mandatory batch preview before one composite mutation; Keep/Unsubscribe stay per-sender.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type Args = Parameters<typeof DomainBatchCard>[0];

/**
 * Fabricate a same-domain run from the shared fixture rows: clone base
 * rows onto one registrable domain so `DomainBatchCard` has a realistic
 * batch to render. `protection` marks a protected member.
 */
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
  { name: 'Amazon Photos' },
]);

function frame(children: React.ReactNode) {
  return <div style={{ background: color.bg, padding: 24, maxWidth: 760 }}>{children}</div>;
}

/** Default — four same-domain senders, all eligible for the batch. */
export const Default: Story<typeof DomainBatchCard> = {
  args: { batch: AMAZON_BATCH, onVerb: () => {}, onDismiss: () => {} },
  render: (args: Args) => frame(<DomainBatchCard {...args} />),
};

/**
 * With a protected member — the protected sender is counted separately and
 * stays untouched by the batch ("N protected senders stay untouched").
 */
export const WithProtected: Story<typeof DomainBatchCard> = {
  args: {
    batch: mkBatch('substack.com', [
      { name: 'The Pragmatic Engineer', protection: 'user-marked' },
      { name: 'Lenny’s Newsletter' },
      { name: 'Money Stuff' },
      { name: 'Stratechery' },
    ]),
    onVerb: () => {},
    onDismiss: () => {},
  },
  render: (args: Args) => frame(<DomainBatchCard {...args} />),
};

/** Busy — this batch's decision is confirming server-side (dimmed). */
export const Busy: Story<typeof DomainBatchCard> = {
  args: { batch: AMAZON_BATCH, busy: true, onVerb: () => {}, onDismiss: () => {} },
  render: (args: Args) => frame(<DomainBatchCard {...args} />),
};

/**
 * Disabled — another decision is confirming, so this card's verbs are
 * inert (the single-slot latch shared with the per-row pipeline).
 */
export const Disabled: Story<typeof DomainBatchCard> = {
  args: { batch: AMAZON_BATCH, disabled: true, onVerb: () => {}, onDismiss: () => {} },
  render: (args: Args) => frame(<DomainBatchCard {...args} />),
};

/** Minimum run — the 3-row floor (`MIN_BATCH_RUN`) that offers a card. */
export const MinimumRun: Story<typeof DomainBatchCard> = {
  args: {
    batch: mkBatch('oldnavy.com', [
      { name: 'Old Navy' },
      { name: 'Old Navy Deals' },
      { name: 'Old Navy Rewards' },
    ]),
    onVerb: () => {},
    onDismiss: () => {},
  },
  render: (args: Args) => frame(<DomainBatchCard {...args} />),
};
