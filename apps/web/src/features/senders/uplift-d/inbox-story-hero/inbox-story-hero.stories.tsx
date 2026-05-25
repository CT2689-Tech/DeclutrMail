// Storybook stories for <InboxStoryHero /> (Variant D, ADR-0007 lazy).

import type { ReactNode } from 'react';
import { InboxStoryHero } from './inbox-story-hero';

type StoryFn = (() => ReactNode) & { storyName?: string };
interface Meta {
  title: string;
  component: typeof InboxStoryHero;
}

const meta: Meta = {
  title: 'senders/uplift-d/InboxStoryHero',
  component: InboxStoryHero,
};
export default meta;

export const Default: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7' }}>
    <InboxStoryHero
      eyebrow="Your inbox this week"
      story={[
        <>
          <span style={{ color: '#B45309', fontWeight: 600 }}>312</span> emails reached you.
        </>,
        <>
          Only <span style={{ color: '#006B5F', fontWeight: 600 }}>18%</span> were worth reading.
        </>,
      ]}
      meta={[
        { value: '4.2h', label: 'Reading time / mo' },
        { value: '−8%', label: 'vs last month', deltaTone: 'down' },
      ]}
      ctaCopy={
        <>
          <strong>5 decisions can cut next week's inbox by ~48%.</strong> We'll guide you one at a
          time. 3 minutes.
        </>
      }
      ctaLabel="Start review"
    />
  </div>
);
Default.storyName = 'Default — V1 Senders hero';

export const NoMeta: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7' }}>
    <InboxStoryHero
      eyebrow="Your inbox today"
      story={['25 new senders mailed you in the last 24 hours.']}
      ctaCopy={
        <>
          <strong>Tap each one to set a one-time disposition.</strong> Future mail follows your
          choice.
        </>
      }
      ctaLabel="Start"
    />
  </div>
);
NoMeta.storyName = 'No right-side meta strip';

export const ZeroState: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7' }}>
    <InboxStoryHero
      eyebrow="Your inbox this week"
      story={['No new senders this week.', 'Your existing senders are quiet too.']}
      meta={[{ value: '0h', label: 'Reading time / mo' }]}
      ctaCopy={
        <>
          <strong>Nothing to review.</strong> Your weekly check-in is paused until new mail arrives.
        </>
      }
      ctaLabel="See history"
    />
  </div>
);
ZeroState.storyName = 'Zero-state (no senders, no decisions)';

export const NoUpDelta: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7' }}>
    <InboxStoryHero
      eyebrow="Your inbox this week"
      story={[
        <>
          <span style={{ color: '#B45309', fontWeight: 600 }}>487</span> emails reached you — a
          spike from your usual.
        </>,
      ]}
      meta={[
        { value: '6.8h', label: 'Reading time / mo' },
        { value: '+22%', label: 'vs last month', deltaTone: 'up' },
      ]}
      ctaCopy={
        <>
          <strong>Volume is up. 12 decisions can cut it back to baseline.</strong> Same 3-minute
          ritual as usual.
        </>
      }
      ctaLabel="Start review"
    />
  </div>
);
NoUpDelta.storyName = 'Volume-up week (amber delta tone)';
