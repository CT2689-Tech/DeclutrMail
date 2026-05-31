// Storybook CSF3 stories for the `KeyboardCheatsheet` (§3.1 — the `?`
// shortcut reference; D210 story coverage).
//
// The shipped wrapper renders null until `?` is pressed, so the stories
// render the presentational `CheatsheetPanel` directly to show the open
// overlay. The verb rows are sourced from the Action Registry (ADR-0015),
// so this story doubles as a visual check that the four canonical K/A/U/L
// labels + shortcuts (D227) resolve from the descriptors.
//
// Mirrors the local-shim pattern used by sibling stories so the file
// typechecks before the PR-3 Storybook seed merges (D210).

import { tokens } from '@declutrmail/shared';

import { CheatsheetPanel } from './keyboard-cheatsheet';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  render?: () => ReturnType<C>;
  parameters?: Record<string, unknown>;
};

const meta: StoryMeta<typeof CheatsheetPanel> = {
  title: 'Features/Senders/KeyboardCheatsheet',
  component: CheatsheetPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'On-demand keyboard reference revealed by `?`. Shortcut labels + keys come from the Action Registry (ADR-0015) so they never drift from the buttons. Shortcuts stay invisible inline (§3.1) and live only here + in per-button tooltips.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

function frame(child: React.ReactNode) {
  return (
    <div style={{ background: tokens.color.bg, minHeight: 520, position: 'relative' }}>{child}</div>
  );
}

export const Open: Story<typeof CheatsheetPanel> = {
  render: () => frame(<CheatsheetPanel onClose={() => undefined} />),
};

// Locks the `width: min(440px, calc(100vw - 32px))` clamp on a phone-width
// viewport — the panel should hug the 16px side gutters, not overflow.
export const NarrowViewport: Story<typeof CheatsheetPanel> = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => frame(<CheatsheetPanel onClose={() => undefined} />),
};
