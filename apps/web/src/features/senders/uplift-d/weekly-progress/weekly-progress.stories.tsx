// Storybook stories for <WeeklyProgress /> (Variant D, ADR-0007 lazy).

import type { ReactNode } from 'react';
import { WeeklyProgress } from './weekly-progress';

type StoryFn = (() => ReactNode) & { storyName?: string };
interface Meta {
  title: string;
  component: typeof WeeklyProgress;
}

const meta: Meta = {
  title: 'senders/uplift-d/WeeklyProgress',
  component: WeeklyProgress,
};
export default meta;

export const Default: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7' }}>
    <WeeklyProgress
      label="This week"
      done={2}
      total={5}
      caption="Estimated savings so far: 3.1h/year"
    />
  </div>
);
Default.storyName = 'Default — mid-week (2 of 5)';

export const JustStarted: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7' }}>
    <WeeklyProgress
      label="This week"
      done={0}
      total={5}
      caption="No decisions yet — pick one to start"
    />
  </div>
);
JustStarted.storyName = 'Just started (0 of 5)';

export const NearlyDone: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7' }}>
    <WeeklyProgress
      label="This week"
      done={4}
      total={5}
      caption="Estimated savings so far: 6.2h/year"
    />
  </div>
);
NearlyDone.storyName = 'Nearly done (4 of 5)';

export const NoCaption: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7' }}>
    <WeeklyProgress label="This week" done={2} total={5} />
  </div>
);
NoCaption.storyName = 'Without caption';

export const ZeroTotalRendersNothing: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7' }}>
    <p style={{ fontSize: 13, color: '#646D69' }}>
      With total=0 the component returns null. Below this paragraph there is no progress strip.
    </p>
    <WeeklyProgress label="This week" done={0} total={0} />
  </div>
);
ZeroTotalRendersNothing.storyName = 'Zero total → renders nothing';
