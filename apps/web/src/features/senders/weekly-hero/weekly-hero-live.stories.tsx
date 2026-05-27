// Storybook CSF3 stories for the live Weekly Hero (D47, D48, D210).
//
// Renders the three D48 slice cards from fixed wire-shape fixtures —
// no API calls, no TanStack Query. Each story locks one shape of the
// data so the design-system gate (D210) can pin the visual contract.
//
// Uses the same lightweight CSF shim other senders stories use until
// the Storybook seed lands.

import type { ComponentProps } from 'react';
import type { WeeklyHeroDto } from '@/lib/api/senders';
import { WeeklyHeroLive } from './weekly-hero-live';

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

const meta: StoryMeta<typeof WeeklyHeroLive> = {
  title: 'Senders/WeeklyHeroLive',
  component: WeeklyHeroLive,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Weekly Hero (D47, D48) — three slice cards (high-confidence cleanups / volume spikes / long-quiet senders). Rendered only on Mondays at the screen level (D47); these stories force-render the component to lock the card visuals.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type HeroArgs = ComponentProps<typeof WeeklyHeroLive>;

const sparkline = (peak: number): number[] =>
  Array.from({ length: 12 }, (_, i) => Math.round((peak * (i + 1)) / 12));

const allSlices: WeeklyHeroDto = {
  isMonday: true,
  weekOf: '2026-05-11',
  slices: [
    {
      kind: 'high_confidence',
      totalCount: 12,
      senders: [
        {
          id: 'hc-1',
          displayName: 'Promo Co',
          email: 'news@promo.co',
          domain: 'promo.co',
          monthlyVolume: 30,
          readRate: 0.05,
          sparkline: sparkline(30),
        },
        {
          id: 'hc-2',
          displayName: 'Deals Daily',
          email: 'hi@deals.com',
          domain: 'deals.com',
          monthlyVolume: 22,
          readRate: 0.04,
          sparkline: sparkline(22),
        },
        {
          id: 'hc-3',
          displayName: 'Sale Alerts',
          email: 'alerts@sale.io',
          domain: 'sale.io',
          monthlyVolume: 18,
          readRate: 0.02,
          sparkline: sparkline(18),
        },
      ],
    },
    {
      kind: 'spike',
      totalCount: 4,
      senders: [
        {
          id: 'sp-1',
          displayName: 'Trending Co',
          email: 'team@trend.co',
          domain: 'trend.co',
          monthlyVolume: 14,
          readRate: 0.3,
          sparkline: sparkline(14),
        },
        {
          id: 'sp-2',
          displayName: 'Burst Inc',
          email: 'team@burst.com',
          domain: 'burst.com',
          monthlyVolume: 9,
          readRate: 0.2,
          sparkline: sparkline(9),
        },
        {
          id: 'sp-3',
          displayName: 'Spike News',
          email: 'news@spike.io',
          domain: 'spike.io',
          monthlyVolume: 6,
          readRate: 0.15,
          sparkline: sparkline(6),
        },
      ],
    },
    {
      kind: 'quiet',
      totalCount: 8,
      senders: [
        {
          id: 'qu-1',
          displayName: 'Old Newsletter',
          email: 'news@oldnews.com',
          domain: 'oldnews.com',
          monthlyVolume: 3,
          readRate: 0.1,
          sparkline: sparkline(3),
        },
        {
          id: 'qu-2',
          displayName: 'Dormant Updates',
          email: 'hi@dormant.io',
          domain: 'dormant.io',
          monthlyVolume: 2,
          readRate: 0.05,
          sparkline: sparkline(2),
        },
        {
          id: 'qu-3',
          displayName: 'Quiet Co',
          email: 'team@quiet.co',
          domain: 'quiet.co',
          monthlyVolume: 1,
          readRate: 0.0,
          sparkline: sparkline(1),
        },
      ],
    },
  ],
};

const noop = () => undefined;

/** All three slices populated — the canonical Monday-morning view. */
export const AllSlices: Story<typeof WeeklyHeroLive> = {
  args: { data: allSlices, onReview: noop, onSkip: noop },
  render: (args: HeroArgs) => (
    <div style={{ padding: 24, maxWidth: 1180 }}>
      <WeeklyHeroLive {...args} />
    </div>
  ),
};

/** Only the high-confidence slice — the other two had < 3 senders BE-side. */
export const HighConfidenceOnly: Story<typeof WeeklyHeroLive> = {
  args: {
    data: {
      ...allSlices,
      slices: allSlices.slices.filter((s) => s.kind === 'high_confidence'),
    },
    onReview: noop,
    onSkip: noop,
  },
  render: (args: HeroArgs) => (
    <div style={{ padding: 24, maxWidth: 1180 }}>
      <WeeklyHeroLive {...args} />
    </div>
  ),
};
