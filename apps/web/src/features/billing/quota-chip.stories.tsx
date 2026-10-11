import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';

import { MeterPreviewLine } from './meter-preview-line';
import { QuotaChip } from './quota-chip';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

const summary: CleanupSummaryDto = {
  metered: true,
  limit: 1000,
  used: 360,
  remaining: 640,
  resetAt: '2026-11-09T00:00:00.000Z',
};

const meta: StoryMeta<typeof QuotaChip> = {
  title: 'Billing/QuotaChip',
  component: QuotaChip,
};

export default meta;

export const Remaining: Story<typeof QuotaChip> = { args: { summary } };

export const Amber: Story<typeof QuotaChip> = {
  args: { summary: { ...summary, used: 800, remaining: 200 } },
};

export const Empty: Story<typeof QuotaChip> = {
  args: { summary: { ...summary, used: 1000, remaining: 0 } },
};

export const NotMetered: Story<typeof QuotaChip> = {
  args: { summary: { ...summary, metered: false } },
};

export const PreviewFits: Story<typeof MeterPreviewLine> = {
  args: { requested: 12, summary },
  render: (args) => <MeterPreviewLine {...args} />,
};
