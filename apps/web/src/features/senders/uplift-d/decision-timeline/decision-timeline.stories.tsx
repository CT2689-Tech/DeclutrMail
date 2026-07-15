// Storybook stories for <DecisionTimeline /> (Variant D, ADR-0007 lazy).

import type { ReactNode } from 'react';
import { DecisionTimeline } from './decision-timeline';

type StoryFn = (() => ReactNode) & { storyName?: string };
interface Meta {
  title: string;
  component: typeof DecisionTimeline;
}

const meta: Meta = {
  title: 'senders/uplift-d/DecisionTimeline',
  component: DecisionTimeline,
};
export default meta;

export const Default: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7', maxWidth: 720 }}>
    <DecisionTimeline
      heading="Decision timeline"
      items={[
        {
          id: '1',
          when: 'today',
          current: true,
          what: (
            <>
              Engine recommends <strong style={{ color: '#B45309' }}>Unsubscribe</strong>{' '}
              <span style={{ color: '#646D69', fontSize: 11.5 }}>· 89% confidence</span>
            </>
          ),
        },
        {
          id: '2',
          when: '3w ago',
          what: (
            <>
              You chose to <strong>Keep</strong>{' '}
              <span style={{ color: '#646D69', fontSize: 11.5 }}>· manual</span>
            </>
          ),
        },
        {
          id: '3',
          when: '2mo ago',
          what: (
            <>
              Engine recommended <strong>Archive</strong> — you accepted{' '}
              <span style={{ color: '#646D69', fontSize: 11.5 }}>· 7 messages affected</span>
            </>
          ),
        },
        {
          id: '4',
          when: '2yr ago',
          what: (
            <>
              First message received{' '}
              <span style={{ color: '#646D69', fontSize: 11.5 }}>· Mar 2024</span>
            </>
          ),
        },
      ]}
    />
  </div>
);
Default.storyName = 'Default — V1 detail-page timeline';

export const SingleItem: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7', maxWidth: 720 }}>
    <DecisionTimeline
      heading="Decision timeline"
      items={[
        {
          id: '1',
          when: 'today',
          current: true,
          what: (
            <>
              First message received{' '}
              <span style={{ color: '#646D69', fontSize: 11.5 }}>· May 2026 · new sender</span>
            </>
          ),
        },
      ]}
    />
  </div>
);
SingleItem.storyName = 'Single item (new sender, no history)';

export const NoHeading: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7', maxWidth: 720 }}>
    <DecisionTimeline
      items={[
        { id: '1', when: 'today', current: true, what: 'Endpoint accepted unsubscribe request' },
        { id: '2', when: 'yesterday', what: 'Engine recommended Unsubscribe' },
      ]}
    />
  </div>
);
NoHeading.storyName = 'No heading (embedded surface)';
