// Storybook stories for <RecommendationBanner /> (D39 layout slot, D245
// disclosure rule).
//
// The states that matter are about TRUTH, not variety: a fresh read, a
// months-old read that says so, and a read with no supporting details to
// list. The banner never carries confidence and never restyles an action.

import type { ReactNode } from 'react';
import { RecommendationBanner } from './recommendation-banner';
import type { Recommendation } from './types';

type StoryFn = (() => ReactNode) & { storyName?: string };
interface Meta {
  title: string;
  component: typeof RecommendationBanner;
}

const meta: Meta = {
  title: 'senders/detail/RecommendationBanner',
  component: RecommendationBanner,
};
export default meta;

/** A real engine sentence — 300 characters is the average on live data. */
const REASONING =
  'UK POS belongs in the Keep bucket because despite being promotional mail, ' +
  'the 100% read rate demonstrates genuine engagement, and the moderate ' +
  'monthly volume of 12 messages is manageable.';

const BASE: Recommendation = {
  verdict: 'keep',
  confidence: 0.85,
  reasoning: REASONING,
  signals: [],
};

const Frame = ({ children }: { children: ReactNode }) => (
  <div style={{ padding: 24, background: '#FAFAF7', maxWidth: 720 }}>{children}</div>
);

export const Recent: StoryFn = () => (
  <Frame>
    <RecommendationBanner
      recommendation={{ ...BASE, scoredAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }}
    />
  </Frame>
);
Recent.storyName = 'Scored recently';

export const Stale: StoryFn = () => (
  <Frame>
    <RecommendationBanner
      recommendation={{ ...BASE, scoredAt: new Date(Date.now() - 130 * 86_400_000).toISOString() }}
    />
  </Frame>
);
Stale.storyName = 'Months old — the age is in the collapsed summary';

export const WithSignals: StoryFn = () => (
  <Frame>
    <RecommendationBanner
      recommendation={{
        ...BASE,
        verdict: 'unsubscribe',
        reasoning: 'Unsubscribe is suggested from 12 messages received in the last 30 days.',
        signals: ['12 messages received in the last 30 days', '8% marked read in the last 30 days'],
        scoredAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      }}
    />
  </Frame>
);
WithSignals.storyName = 'With supporting details';

export const NoAge: StoryFn = () => (
  <Frame>
    <RecommendationBanner recommendation={BASE} />
  </Frame>
);
NoAge.storyName = 'No timestamp on the wire — age omitted, never guessed';
