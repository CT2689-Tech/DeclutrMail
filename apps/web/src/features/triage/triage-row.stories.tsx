// Storybook CSF3 stories for the Triage list row.
//
// Same lightweight local CSF shims as `focus-card.stories.tsx`.
//
// Variants:
//   • Default        — collapsed, a recommended verdict
//   • OutcomeUnknown — held: its start could not be confirmed (D245)

import { tokens } from '@declutrmail/shared';
import { type TriageDecisionRow } from './data';
import { TRIAGE_QUEUE } from './fixtures';
import { TriageRow } from './triage-row';

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

const meta: StoryMeta<typeof TriageRow> = {
  title: 'Triage/Row',
  component: TriageRow,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The list row — sender, verdict and K/A/U/L/D. A row whose decision may still be running is held: dimmed, its verbs off, and it says what is known.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type Args = Parameters<typeof TriageRow>[0];

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
        width: 'min(880px, calc(100vw - 32px))',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );
}

const base = { expanded: false, onToggleExpand: () => {}, onAction: () => {} };

export const Default: Story<typeof TriageRow> = {
  args: { ...base, row: row('t-linkedin') },
  render: (args: Args) => frame(<TriageRow {...args} />),
};

export const OutcomeUnknown: Story<typeof TriageRow> = {
  args: { ...base, row: row('t-linkedin'), busy: true, unknownVerb: 'Archive' },
  render: (args: Args) => frame(<TriageRow {...args} />),
};
