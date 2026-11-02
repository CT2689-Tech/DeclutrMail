// Storybook CSF3 stories for Settings → Plan: one row to Plan & billing.
// Same lightweight local CSF shims as its sibling settings cards.

import { PlanGroup } from './plan-group';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
};

const meta: StoryMeta<typeof PlanGroup> = {
  title: 'Settings/PlanGroup',
  component: PlanGroup,
  parameters: { layout: 'padded' },
};
export default meta;

export const Ready: Story<typeof PlanGroup> = {
  args: { state: { kind: 'ready', planName: 'Free', foundingMember: false } },
};

export const FoundingMember: Story<typeof PlanGroup> = {
  args: { state: { kind: 'ready', planName: 'Pro', foundingMember: true } },
};

/** The billing read is still out: the row is there and names no plan yet. */
export const Loading: Story<typeof PlanGroup> = {
  args: { state: { kind: 'loading' } },
};

/** Billing is switched off; the plan named is the one `me` reports. */
export const BillingOff: Story<typeof PlanGroup> = {
  args: { state: { kind: 'disabled', planName: 'Plus' } },
};

export const ReadFailed: Story<typeof PlanGroup> = {
  args: { state: { kind: 'error', onRetry: () => undefined } },
};
