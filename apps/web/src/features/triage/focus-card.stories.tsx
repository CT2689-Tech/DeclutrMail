// Storybook CSF3 stories for the Triage focus card.
//
// Same lightweight local CSF shims as `triage-screen.stories.tsx`.
//
// Variants:
//   • Default        — a recommended verdict: one filled verb
//   • NoSuggestion   — confidence under the floor: every verb quiet (D31)
//   • Protected      — the Protected mark + the exact evidence
//   • WhyOpen        — reasoning, band, stats and signals disclosed
//   • Busy           — the decision is confirming server-side
//   • InlinePreview  — D34 path: the mandatory preview inside the card

import { tokens } from '@declutrmail/shared';
import { TRIAGE_QUEUE, type TriageDecisionRow } from './data';
import { TriageFocusCard } from './focus-card';

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

const meta: StoryMeta<typeof TriageFocusCard> = {
  title: 'Triage/FocusCard',
  component: TriageFocusCard,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Focus mode’s card — one sender, one big number, the why, and K/A/U/L/D with the engine’s suggestion as the only filled verb. Owns no decision logic: every verb leaves through `onAction`, so the D226 sheet/preview gates it exactly as in the list.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type Args = Parameters<typeof TriageFocusCard>[0];

function row(id: string): TriageDecisionRow {
  const found = TRIAGE_QUEUE.find((r) => r.id === id);
  if (!found) throw new Error(`fixture missing row ${id}`);
  return found;
}

function frame(children: React.ReactNode) {
  return (
    <div
      style={{
        background: color.bg,
        padding: 'clamp(12px, 3vw, 24px)',
        width: 'min(560px, calc(100vw - 32px))',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );
}

const base = { whyOpen: false, onToggleWhy: () => {}, onAction: () => {} };

export const Default: Story<typeof TriageFocusCard> = {
  args: { ...base, row: row('t-linkedin') },
  render: (args: Args) => frame(<TriageFocusCard {...args} />),
};

export const NoSuggestion: Story<typeof TriageFocusCard> = {
  args: { ...base, row: { ...row('t-linkedin'), confidence: 0.4 } },
  render: (args: Args) => frame(<TriageFocusCard {...args} />),
};

export const Protected: Story<typeof TriageFocusCard> = {
  args: { ...base, row: row('t-sarah') },
  render: (args: Args) => frame(<TriageFocusCard {...args} />),
};

export const WhyOpen: Story<typeof TriageFocusCard> = {
  args: { ...base, row: row('t-linkedin'), whyOpen: true },
  render: (args: Args) => frame(<TriageFocusCard {...args} />),
};

export const Busy: Story<typeof TriageFocusCard> = {
  args: { ...base, row: row('t-linkedin'), busy: true },
  render: (args: Args) => frame(<TriageFocusCard {...args} />),
};

export const InlinePreview: Story<typeof TriageFocusCard> = {
  args: {
    ...base,
    row: row('t-groupon'),
    inlinePreview: { verb: 'Archive', archiveHistoric: false, inboxCount: 47, wakeAt: null },
  },
  render: (args: Args) => frame(<TriageFocusCard {...args} />),
};
