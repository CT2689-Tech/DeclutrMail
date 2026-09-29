// Storybook CSF3 stories for SelectWell — the capsule-well native select
// used by Settings (Brief hour), Quiet hours (timezone) and the Brief day
// switcher. Same lightweight local CSF shims as the sibling settings
// stories.

import { SelectWell } from './settings-list';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
};

const meta: StoryMeta<typeof SelectWell> = {
  title: 'Settings/SelectWell',
  component: SelectWell,
  parameters: { layout: 'padded' },
};
export default meta;

const options = ['7:00 AM', '8:00 AM', '9:00 AM'].map((label) => (
  <option key={label} value={label}>
    {label}
  </option>
));

export const Default: Story<typeof SelectWell> = {
  args: { 'aria-label': 'Daily Brief delivery hour', defaultValue: '8:00 AM', children: options },
};
export const Disabled: Story<typeof SelectWell> = {
  args: {
    'aria-label': 'Daily Brief delivery hour',
    defaultValue: '8:00 AM',
    disabled: true,
    children: options,
  },
};
