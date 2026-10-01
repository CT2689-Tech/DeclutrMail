import type { ComponentProps } from 'react';

import { ActivityFilterDialog } from './activity-filter-dialog';

type Props = ComponentProps<typeof ActivityFilterDialog>;

const defaults: Props = {
  isMobile: false,
  source: 'all',
  verbs: [],
  outcomes: [],
  window: '30d',
  dateFrom: null,
  dateTo: null,
  groupMode: 'none',
  onClose: () => undefined,
  onSource: () => undefined,
  onVerbs: () => undefined,
  onOutcomes: () => undefined,
  onWindow: () => undefined,
  onRange: () => undefined,
  onGroupMode: () => undefined,
};

export default {
  title: 'Features/Activity/FilterDialog',
  component: ActivityFilterDialog,
  parameters: { layout: 'fullscreen' },
};

export const Desktop = {
  args: defaults,
  render: (args: Props) => (
    <div style={{ position: 'relative', width: 420, margin: '20px auto' }}>
      <ActivityFilterDialog {...args} />
    </div>
  ),
};

export const Mobile = {
  args: { ...defaults, isMobile: true },
};

export const Filtered = {
  ...Desktop,
  args: {
    ...defaults,
    source: 'manual',
    outcomes: ['failed'],
    dateFrom: '2026-09-01T00:00:00.000Z',
    dateTo: '2026-09-30T00:00:00.000Z',
    groupMode: 'sender',
  },
};
