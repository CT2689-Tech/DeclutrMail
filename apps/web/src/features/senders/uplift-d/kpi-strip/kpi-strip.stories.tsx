// Storybook stories for <KpiStrip /> (Variant D, ADR-0007 lazy-promoted).
//
// CSF3 local shim — when Storybook lands per D210, this file's import
// flips from the shim to `@storybook/react`; the story shapes don't
// change.

import type { ReactNode } from 'react';
import { KpiStrip } from './kpi-strip';

type StoryFn = (() => ReactNode) & { storyName?: string };
interface Meta {
  title: string;
  component: typeof KpiStrip;
}

const meta: Meta = {
  title: 'senders/uplift-d/KpiStrip',
  component: KpiStrip,
};
export default meta;

// Inline tiny spark fixtures so stories don't need the real <Spark>
// primitive. Replace with the real one when Storybook lands and the
// import path is resolvable.
const TinySpark = ({ stroke }: { stroke: string }) => (
  <svg viewBox="0 0 80 14" width="80" height="14" preserveAspectRatio="none">
    <path
      d="M0,10 L13,8 L26,9 L40,5 L53,6 L66,3 L80,1"
      fill="none"
      stroke={stroke}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Default: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7' }}>
    <KpiStrip
      cells={[
        { label: 'Senders', value: 12, micro: <TinySpark stroke="#4B5552" /> },
        {
          label: 'Noise reducible',
          value: '~48',
          unit: '%',
          micro: <TinySpark stroke="#B45309" />,
        },
        { label: 'Time cost', value: '4.2', unit: 'h/mo', micro: <TinySpark stroke="#047857" /> },
        { label: 'Protected', value: 3, micro: 'VIPs · receipts' },
        { label: 'Needs review', value: 8, micro: <TinySpark stroke="#006B5F" /> },
      ]}
    />
  </div>
);
Default.storyName = 'Default — 5 cells (Variant D Senders)';

export const FourCells: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7' }}>
    <KpiStrip
      cells={[
        { label: 'Volume', value: 23, unit: '/mo', micro: '↑ 40% vs prior 3mo' },
        { label: 'Read rate', value: 12, unit: '%', micro: 'below 20% all year' },
        { label: 'Relationship', value: 2, unit: 'yr', micro: 'Since Mar 2024' },
        { label: 'Reading cost', value: 37, unit: 'min/mo', micro: '~7.4h/year' },
      ]}
    />
  </div>
);
FourCells.storyName = '4 cells (Sender detail KPI)';

export const ZeroValues: StoryFn = () => (
  <div style={{ padding: 24, background: '#FAFAF7' }}>
    <KpiStrip
      cells={[
        { label: 'Senders', value: 0 },
        { label: 'Noise reducible', value: '—' },
        { label: 'Time cost', value: 0, unit: 'h/mo' },
        { label: 'Protected', value: 0 },
        { label: 'Needs review', value: 0 },
      ]}
    />
  </div>
);
ZeroValues.storyName = 'Zero values (first-sync empty state)';
