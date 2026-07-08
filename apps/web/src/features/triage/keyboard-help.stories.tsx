// Storybook CSF3 stories for the Triage keyboard-hint overlay (D37,
// D29, D227).
//
// Storybook itself is seeded in PR 3 (D210). Until the seed lands, this
// file uses the same lightweight local CSF shims as
// `triage-screen.stories.tsx` so it typechecks without
// `@storybook/react` installed.
//
// The stateful wrapper (`TriageKeyboardHelp`) renders null until `?` is
// pressed, so the story targets the presentational `…Panel` half
// directly — the same split the senders `KeyboardCheatsheet` story
// uses to show the open state without simulating a keystroke. Every
// documented shortcut maps to a REAL binding (K/A/U/L per D227; nothing
// aspirational).

import { tokens } from '@declutrmail/shared';
import { TriageKeyboardHelpPanel } from './keyboard-help';

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

const meta: StoryMeta<typeof TriageKeyboardHelpPanel> = {
  title: 'Triage/KeyboardHelp',
  component: TriageKeyboardHelpPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Keyboard-hint overlay revealed with `?` (Escape / close button / backdrop dismiss). Shortcuts stay invisible inline and appear only on demand — same pattern as the senders cheatsheet. Every row documents a REAL binding: K/A/U/L (D29 + D227), Enter/Space expand, Z undo, ⌘⏎ confirm, Esc cancel, ? toggle.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

function frame(children: React.ReactNode) {
  // A tall backdrop so the modal + blurred backdrop have context.
  return (
    <div style={{ background: color.bg, minHeight: '100vh', position: 'relative' }}>{children}</div>
  );
}

/** Open — the overlay as `?` reveals it, over the triage backdrop. */
export const Open: Story<typeof TriageKeyboardHelpPanel> = {
  render: () => frame(<TriageKeyboardHelpPanel onClose={() => {}} />),
};
