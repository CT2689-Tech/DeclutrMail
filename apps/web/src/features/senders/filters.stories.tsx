// Storybook CSF3 stories for the Senders filters (D38, D210): the panel
// behind `[Filter]`, the active-filter chip row, and the Sort menu.

import { useState } from 'react';
import {
  ActiveFilterChips,
  DEFAULT_COMPOSE,
  EMPTY_COMPOSE,
  FilterButton,
  FilterPanel,
  SortMenu,
  type ComposeState,
} from './filters';
import type { SenderListDirection, SenderListSort } from '@/lib/api/senders';

type Story = { render: () => React.ReactElement };

const meta = {
  title: 'Senders/Filters',
  component: FilterPanel,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Every filter control lives behind one `Filter` button; what is on comes back as removable chips. Alt-click / right-click a chip to exclude. Counts are mailbox-wide absolutes per axis.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

const COUNTS = {
  total: 2871,
  active: 508,
  quiet: 913,
  dormant: 1450,
  unsubReady: 2368,
  wroteTo: 41,
  protected: 27,
  unsubIgnored: 6,
};

function Header({ initial }: { initial: ComposeState }) {
  const [state, setState] = useState(initial);
  const [sort, setSort] = useState<{ sort: SenderListSort; direction: SenderListDirection }>({
    sort: 'total',
    direction: 'desc',
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 520 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <FilterButton
          state={state}
          counts={COUNTS}
          onChange={setState}
          onClear={() => setState(EMPTY_COMPOSE)}
          domainSuggestions={['amazon.com', 'linkedin.com', 'substack.com']}
          views={{
            names: ['Noisy promos'],
            onApply: () => undefined,
            onSave: () => undefined,
            onDelete: () => undefined,
            canSaveCurrent: true,
            capReached: false,
          }}
        />
        <SortMenu {...sort} onChange={setSort} />
      </div>
      <ActiveFilterChips
        state={state}
        onChange={setState}
        onClear={() => setState(EMPTY_COMPOSE)}
      />
    </div>
  );
}

/** First visit: active-only, and NO chip row. */
export const DefaultHeader: Story = { render: () => <Header initial={DEFAULT_COMPOSE} /> };

export const WithActiveFilters: Story = {
  render: () => (
    <Header
      initial={{
        ...EMPTY_COMPOSE,
        activity: 'dormant',
        unsubReady: true,
        protectedFlag: false,
        windowDays: 180,
        domain: 'linkedin.com',
      }}
    />
  ),
};

export const PanelOpen: Story = {
  render: () => (
    <div style={{ maxWidth: 340 }}>
      <FilterPanel
        state={{ ...DEFAULT_COMPOSE, wroteTo: false }}
        counts={COUNTS}
        onChange={() => undefined}
        onClear={() => undefined}
        domainSuggestions={['amazon.com']}
      />
    </div>
  ),
};
