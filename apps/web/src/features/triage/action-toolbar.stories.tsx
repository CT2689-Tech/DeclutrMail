// Storybook CSF3 stories for the Triage action toolbar (D29, D31, D227).
//
// Storybook itself is seeded in PR 3 (D210). Until the seed lands,
// this file uses the same lightweight local CSF shims as
// `triage-screen.stories.tsx` so it typechecks without
// `@storybook/react` installed.
//
// The two D31 variants below are the load-bearing comparison:
//   • Highlighted   — confidence > 0.85, recommended verb glows
//   • Flat          — confidence ≤ 0.85, all four verbs equal weight
// The 0.85 / 0.86 boundary tests in action-toolbar.test.tsx pin the
// strict-greater-than semantics. These stories are the visual proof.

import { tokens } from '@declutrmail/shared';
import { ActionToolbar } from './action-toolbar';
import { TRIAGE_QUEUE, type TriageDecisionRow } from './data';

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

const meta: StoryMeta<typeof ActionToolbar> = {
  title: 'Triage/ActionToolbar',
  component: ActionToolbar,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Triage row action toolbar — K/A/U/L per D29 + D227. Per D31 the engine’s verdict is emphasised ONLY when confidence is strictly greater than 0.85; below that threshold every verb renders flat.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Find Groupon (verdict=archive, no protection) as our test fixture. */
function baseRow(): TriageDecisionRow {
  const row = TRIAGE_QUEUE.find((r) => r.id === 't-groupon');
  if (!row) throw new Error('fixture missing t-groupon');
  return row;
}

function frame(children: React.ReactNode) {
  return (
    <div
      style={{
        background: color.bg,
        padding: 32,
        minWidth: 540,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      {children}
    </div>
  );
}

/**
 * D31 — recommended-verb emphasis: confidence ABOVE the 0.85 threshold.
 * Archive renders with a darker tone and a white-on-translucent K/A/U/L
 * shortcut chip, drawing the eye without locking focus.
 */
export const HighlightedRecommendation: Story<typeof ActionToolbar> = {
  args: {
    row: { ...baseRow(), confidence: 0.94 },
    onAction: () => {},
    keyboardEnabled: false,
  },
  render: (args) => frame(<ActionToolbar {...args} />),
};

/**
 * D31 — confidence below the 0.85 threshold renders flat. All four
 * verbs sit at equal weight; the user decides without the engine
 * tipping the scale.
 */
export const FlatBelowThreshold: Story<typeof ActionToolbar> = {
  args: {
    row: { ...baseRow(), confidence: 0.66 },
    onAction: () => {},
    keyboardEnabled: false,
  },
  render: (args) => frame(<ActionToolbar {...args} />),
};

/**
 * D31 boundary — exact threshold (0.85). Strict > means no
 * emphasis. Pairs with `HighlightAtBoundaryAbove` to demonstrate the
 * one-pip cliff between "flat" and "glow."
 */
export const FlatAtBoundary: Story<typeof ActionToolbar> = {
  args: {
    row: { ...baseRow(), confidence: 0.85 },
    onAction: () => {},
    keyboardEnabled: false,
  },
  render: (args) => frame(<ActionToolbar {...args} />),
};

/**
 * D31 boundary — first emphasised pip (0.86). The very next confidence
 * tick above 0.85 surfaces the recommendation glow.
 */
export const HighlightAtBoundaryAbove: Story<typeof ActionToolbar> = {
  args: {
    row: { ...baseRow(), confidence: 0.86 },
    onAction: () => {},
    keyboardEnabled: false,
  },
  render: (args) => frame(<ActionToolbar {...args} />),
};
