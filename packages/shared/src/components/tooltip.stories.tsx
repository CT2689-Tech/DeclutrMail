// packages/shared/src/components/tooltip.stories.tsx
//
// Visual reference for the D38 description tooltip. Per D210, every new
// shared component ships with Storybook coverage.
//
// Uses the same locally-declared CSF shims as its sibling primitive
// stories (`numeric-display.stories.tsx`) so it typechecks in this
// package without the Storybook framework types.

import { Button } from './button';
import { Tooltip } from './tooltip';
import { tokens } from '../tokens/tokens';

const { color, font } = tokens;

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story = {
  parameters?: Record<string, unknown>;
  render?: () => unknown;
};

const meta: StoryMeta<typeof Tooltip> = {
  title: 'Primitives/Tooltip',
  component: Tooltip,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Description tooltip for an interactive control (D38). Opens on hover AND on keyboard focus, closes on Escape. The bubble is always in the DOM — visually hidden when closed — so the `aria-describedby` the trigger carries always resolves. No animation, so there is nothing for prefers-reduced-motion to degrade.',
      },
    },
  },
};
export default meta;

/**
 * The shipped shape: a verb button described by one plain sentence.
 * Hover it, or Tab to it — both open the bubble.
 */
export const OnAButton: Story = {
  render: () => (
    <div style={{ padding: '60px 40px', fontFamily: font.sans }}>
      <Tooltip
        content={
          <>
            <span style={{ fontWeight: 600 }}>Archive</span>
            <span style={{ fontFamily: font.mono }}> · A</span>
            <br />
            Matching email currently in Inbox moves out of Inbox and stays in Gmail.
          </>
        }
      >
        {({ describedBy }) => (
          <Button tone="default" ariaDescribedBy={describedBy}>
            Archive
          </Button>
        )}
      </Tooltip>
    </div>
  ),
};

/** `placement="bottom"` for triggers near the top of a surface. */
export const BelowTheTrigger: Story = {
  render: () => (
    <div style={{ padding: '40px 40px 80px', fontFamily: font.sans }}>
      <Tooltip placement="bottom" content="Moves matching inbox mail to Gmail Trash.">
        {({ describedBy }) => (
          <Button tone="danger" ariaDescribedBy={describedBy}>
            Delete
          </Button>
        )}
      </Tooltip>
    </div>
  ),
};

/** A row of triggers — the toolbar case the tooltip was built for. */
export const InARow: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, padding: '60px 40px', fontFamily: font.sans }}>
      {[
        ['Keep', 'DeclutrMail remembers Keep as your decision for this sender.'],
        ['Later', 'Matching email currently in Inbox moves to the DeclutrMail/Later label.'],
      ].map(([label, effect]) => (
        <Tooltip key={label} content={effect}>
          {({ describedBy }) => (
            <Button tone="default" ariaDescribedBy={describedBy}>
              {label}
            </Button>
          )}
        </Tooltip>
      ))}
      <span style={{ alignSelf: 'center', fontSize: 12, color: color.fgMuted }}>
        Hover or Tab through them.
      </span>
    </div>
  ),
};
