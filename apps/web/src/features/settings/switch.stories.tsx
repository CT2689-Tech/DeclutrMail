// Storybook CSF3 stories for the one Switch (ADR-0042) — off, on and
// disabled. Same lightweight local CSF shims as the sibling settings
// stories.

import { Switch } from './switch';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
};

const meta: StoryMeta<typeof Switch> = {
  title: 'Settings/Switch',
  component: Switch,
  parameters: { layout: 'padded' },
};
export default meta;

const noop = () => {};

export const Off: Story<typeof Switch> = {
  args: { checked: false, onChange: noop, ariaLabel: 'Daily Brief email' },
};
export const On: Story<typeof Switch> = {
  args: { checked: true, onChange: noop, ariaLabel: 'Daily Brief email' },
};
export const Disabled: Story<typeof Switch> = {
  args: { checked: true, onChange: noop, ariaLabel: 'Daily Brief email', disabled: true },
};
