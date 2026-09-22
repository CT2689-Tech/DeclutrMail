// packages/shared/src/shell/app-shell.stories.tsx
//
// Visual reference for the five-group rail, contextual feature navigation,
// the quiet top bar with the `?` help button, and (at ≤760px
// viewports) the horizontal workspace groups. Per D210, shared components ship with
// Storybook coverage.
//
// Uses the same locally-declared CSF shims as the sibling primitive
// stories so it typechecks without the Storybook framework types.

import { ScreenIntro } from '../components/screen-intro';
import { tokens } from '../tokens/tokens';
import { AppShell } from './app-shell';
import { Sidebar } from './sidebar';

const { color, font, text } = tokens;

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
};

type Story = {
  parameters?: Record<string, unknown>;
  render?: () => unknown;
};

const meta: StoryMeta<typeof AppShell> = {
  title: 'Shell/AppShell',
  component: AppShell,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'App chrome. The fixed 72px rail groups the workspace into Overview, Clean up, Automations, Catch up and Activity, with Settings below. Section navigation exposes child screens, counts and plan gates. The top bar holds account controls and contextual help. At 760px and below, the same five groups form a horizontal row above the workspace; the hamburger opens the complete feature menu.',
      },
    },
  },
};

export default meta;

const COUNTS = {
  senders: 214,
  screener: { text: 7, label: '7 new senders waiting in Screener' },
};
const LOCKS = { brief: 'Pro', followups: 'Pro' };

function Screen() {
  return (
    <div style={{ maxWidth: 880, padding: 24, fontFamily: font.sans, color: color.fg }}>
      <ScreenIntro
        id="story"
        title="Senders"
        body="Everyone who emails you, busiest first."
        tip="Press ? on the screen for keyboard shortcuts."
        learnMore={{ href: '/help', label: 'What each action does' }}
      />
      <h1 style={{ margin: 0, fontSize: text['2xl'], fontWeight: 600 }}>Your senders</h1>
    </div>
  );
}

// The screen registers help through `<ScreenIntro>`, so the top bar shows
// the `?` button; clicking it opens the help popover.
export const Default: Story = {
  render: () => (
    <div style={{ height: '100vh' }}>
      <AppShell active="senders" onNavigate={() => undefined} counts={COUNTS} locks={LOCKS}>
        <Screen />
      </AppShell>
    </div>
  ),
};

// No `<ScreenIntro>` mounted → no `?` in the top bar (it never opens onto
// an empty panel).
export const NoScreenHelp: Story = {
  render: () => (
    <div style={{ height: '100vh' }}>
      <AppShell active="senders" onNavigate={() => undefined} counts={COUNTS} locks={LOCKS}>
        <div style={{ padding: 24, fontFamily: font.sans, color: color.fg }}>Page content</div>
      </AppShell>
    </div>
  ),
};

export const IconRail: Story = {
  render: () => (
    <div style={{ height: 480, display: 'flex' }}>
      <Sidebar
        active="senders"
        onNavigate={() => undefined}
        counts={COUNTS}
        locks={LOCKS}
        collapsed
      />
    </div>
  ),
};

export const MobileTabBar: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: Default.render!,
};
