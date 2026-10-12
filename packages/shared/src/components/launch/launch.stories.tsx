import type { ReactNode } from 'react';
import { CaughtUp } from './caught-up';
import { ComingWithPro } from './coming-with-pro';
import { FeatureExplainer } from './feature-explainer';
import { TrustLine } from './trust-line';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
};

type Story = {
  render: () => ReactNode;
};

const meta: StoryMeta<typeof TrustLine> = {
  title: 'Primitives/Launch',
  component: TrustLine,
  parameters: { layout: 'centered' },
};

export default meta;

export const Trust: Story = {
  render: () => <TrustLine />,
};

export const CaughtUpResting: Story = {
  render: () => <CaughtUp title="You’re caught up" description="Nothing is waiting." />,
};

export const ComingWithProOpen: Story = {
  render: () => (
    <ComingWithPro
      proName="Pro"
      title="Daily Brief"
      pitch="A daily summary of yesterday’s email in DeclutrMail, ready at an hour you choose."
      joined={false}
      onJoin={() => undefined}
    />
  ),
};

export const Explainer: Story = {
  render: () => <FeatureExplainer id="explain-triage">One sender at a time.</FeatureExplainer>,
};
