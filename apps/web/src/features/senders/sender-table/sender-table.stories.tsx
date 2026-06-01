// Storybook CSF3 stories for the SenderTable (Slice 1 / Step 6, D210,
// D211, D212, ADR-0014).
//
// Same lightweight local CSF shims as `sender-list-row.stories.tsx` so
// the file typechecks without `@storybook/react` installed — the seed
// PR for Storybook swaps the shims for real imports without touching
// the story shapes.
//
// Acceptance criteria (D210 default + D211/D212 edge):
//   • Default / Total ↓ — sorted by total, magnitude bar visible.
//   • Sort affordances render `aria-sort` on the active column.
//   • Density toggle compact vs comfortable — column geometry stable.
//   • Loading skeleton preserves column count (no horizontal jump).
//   • Error row renders + offers retry.
//   • Empty: no senders, no filter match, no search match (3 copies).
//   • Mixed-state row: protected sender, unknown trend, never-read, etc.
//   • Long display name and very long domain truncate without breaking
//     the column grid.

import { useState } from 'react';
import type { ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';

import type { SenderListRow, SenderListDirection, SenderListSort } from '@/lib/api/senders';
import { SenderTable } from './sender-table';

const { color } = tokens;

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

const meta: StoryMeta<typeof SenderTable> = {
  title: 'Senders / SenderTable',
  component: SenderTable,
  tags: ['autodocs'],
};
export default meta;

// ── Fixtures ──────────────────────────────────────────────────────────

function row(overrides: Partial<SenderListRow> = {}): SenderListRow {
  return {
    id: overrides.id ?? `s-${Math.random().toString(36).slice(2, 9)}`,
    displayName: overrides.displayName ?? 'Bank of America',
    email: overrides.email ?? 'onlinebanking@ealerts.bankofamerica.com',
    domain: overrides.domain ?? 'ealerts.bankofamerica.com',
    gmailCategory: overrides.gmailCategory ?? 'updates',
    firstSeenAt: overrides.firstSeenAt ?? '2013-08-11T20:18:16.000Z',
    lastSeenAt: overrides.lastSeenAt ?? '2026-05-28T13:01:34.000Z',
    totalReceived: overrides.totalReceived ?? 6471,
    monthlyVolume: overrides.monthlyVolume ?? 61,
    readRate: overrides.readRate ?? 0,
    volumeTrend: overrides.volumeTrend ?? 'steady',
    unsubscribeMethod: overrides.unsubscribeMethod ?? 'none',
    lastReview: overrides.lastReview ?? null,
    protectionFlags: overrides.protectionFlags ?? {
      isVip: false,
      isProtected: false,
      protectionReason: null,
      protectionSetAt: null,
    },
  };
}

const DEFAULT_ROWS: SenderListRow[] = [
  row({
    id: 'r-1',
    displayName: 'Bank of America',
    domain: 'ealerts.bankofamerica.com',
    totalReceived: 6471,
    monthlyVolume: 61,
    readRate: 0,
    volumeTrend: 'steady',
    unsubscribeMethod: 'none',
  }),
  row({
    id: 'r-2',
    displayName: 'CT2689',
    domain: 'github.com',
    totalReceived: 2908,
    monthlyVolume: 1744,
    readRate: 0.01,
    volumeTrend: 'up',
    unsubscribeMethod: 'mailto',
    lastSeenAt: '2026-01-25T00:00:00.000Z',
  }),
  row({
    id: 'r-3',
    displayName: '',
    email: 'noreply@etherscan.io',
    domain: 'etherscan.io',
    totalReceived: 1855,
    monthlyVolume: 45,
    readRate: 0.02,
    volumeTrend: 'down',
    unsubscribeMethod: 'one_click',
    lastSeenAt: '2026-05-28T19:02:36.000Z',
  }),
  row({
    id: 'r-4',
    displayName: 'HDFC Bank InstaAlerts',
    domain: 'hdfcbank.net',
    totalReceived: 1209,
    monthlyVolume: 1,
    readRate: null,
    volumeTrend: 'dormant',
    unsubscribeMethod: 'mailto',
  }),
  row({
    id: 'r-5',
    displayName: 'Robinhood',
    domain: 'robinhood.com',
    totalReceived: 1106,
    monthlyVolume: 148,
    readRate: 0.45,
    volumeTrend: 'new',
    unsubscribeMethod: 'one_click',
  }),
  row({
    id: 'r-6',
    displayName: 'Splitwise',
    domain: 'splitwise.com',
    totalReceived: 966,
    monthlyVolume: 22,
    readRate: 0.88,
    volumeTrend: 'steady',
    unsubscribeMethod: 'one_click',
    protectionFlags: {
      isVip: false,
      isProtected: true,
      protectionReason: 'user_defined',
      protectionSetAt: '2026-01-01T00:00:00.000Z',
    },
  }),
];

const GLOBAL_MAX = 6471;

// ── Common controlled-wrapper render ──────────────────────────────────

/** Render the table as a controlled component so the stories can demo
 *  the sort + selection + density interactions without forcing each
 *  story to wire its own state. */
function ControlledTable(props: Partial<ComponentProps<typeof SenderTable>>) {
  const [sort, setSort] = useState<SenderListSort>(props.sort ?? 'total');
  const [direction, setDirection] = useState<SenderListDirection>(props.direction ?? 'desc');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    props.selectedIds ?? new Set(),
  );
  const noop = (_args: unknown) => {};
  return (
    <div style={{ padding: 20, background: color.bg, minHeight: 600 }}>
      <SenderTable
        rows={props.rows ?? DEFAULT_ROWS}
        globalMaxTotal={props.globalMaxTotal ?? GLOBAL_MAX}
        sort={sort}
        direction={direction}
        onSortChange={(next) => {
          setSort(next.sort);
          setDirection(next.direction);
        }}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onAction={props.onAction ?? noop}
        loading={props.loading ?? false}
        error={props.error ?? null}
        onRetry={props.onRetry}
        emptyKind={props.emptyKind}
        density={props.density}
      />
    </div>
  );
}

// ── Stories — D210 default + states ───────────────────────────────────

export const Default: Story<typeof SenderTable> = {
  render: () => <ControlledTable />,
};

export const SortByLastSeen: Story<typeof SenderTable> = {
  render: () => <ControlledTable sort="last_seen" direction="desc" />,
};

export const SortByName: Story<typeof SenderTable> = {
  render: () => <ControlledTable sort="name" direction="asc" />,
};

export const Compact: Story<typeof SenderTable> = {
  render: () => <ControlledTable density="compact" />,
};

export const WithSelection: Story<typeof SenderTable> = {
  render: () => <ControlledTable selectedIds={new Set(['r-1', 'r-3'])} />,
};

// ── Stories — D210 loading ────────────────────────────────────────────

export const Loading: Story<typeof SenderTable> = {
  render: () => <ControlledTable rows={[]} loading={true} />,
};

// ── Stories — D211 error + empty trio ─────────────────────────────────

export const ErrorState: Story<typeof SenderTable> = {
  render: () => (
    <ControlledTable
      rows={[]}
      error={{ message: 'Network connection lost while loading senders.' }}
      onRetry={() => {}}
    />
  ),
};

export const EmptyNoSenders: Story<typeof SenderTable> = {
  render: () => <ControlledTable rows={[]} emptyKind="no-senders" />,
};

export const EmptyNoFilterMatch: Story<typeof SenderTable> = {
  render: () => <ControlledTable rows={[]} emptyKind="no-filter-match" />,
};

export const EmptyNoSearchMatch: Story<typeof SenderTable> = {
  render: () => <ControlledTable rows={[]} emptyKind="no-search-match" />,
};

// ── Stories — D212 edge data shapes ──────────────────────────────────

export const NullableData: Story<typeof SenderTable> = {
  render: () => (
    <ControlledTable
      rows={[
        row({
          id: 'n-1',
          displayName: 'Pristine sender — no timeseries yet',
          totalReceived: 0,
          readRate: null,
          volumeTrend: null,
          unsubscribeMethod: null,
        }),
        row({
          id: 'n-2',
          displayName: 'No display name on this one',
          totalReceived: 12,
          readRate: 0,
          volumeTrend: 'new',
          unsubscribeMethod: 'none',
        }),
      ]}
    />
  ),
};

export const ZeroGlobalMaxTotal: Story<typeof SenderTable> = {
  render: () => (
    <ControlledTable
      rows={[
        row({ id: 'z-1', displayName: 'Brand new mailbox', totalReceived: 0 }),
        row({ id: 'z-2', displayName: 'Also zero', totalReceived: 0 }),
      ]}
      globalMaxTotal={0}
    />
  ),
};

export const LongNameAndDomain: Story<typeof SenderTable> = {
  render: () => (
    <ControlledTable
      rows={[
        row({
          id: 'long-1',
          displayName:
            'Very Long Sender Name That Should Ellipsis Without Breaking The Column Grid',
          domain: 'extremely.long.sub.subdomain.example-marketing-platform.io',
          totalReceived: 4321,
        }),
        row({
          id: 'long-2',
          displayName: '',
          email: 'a-very-long-email-address-that-also-tests-truncation@example.com',
          domain: 'example.com',
          totalReceived: 2100,
        }),
      ]}
    />
  ),
};

export const HighlyProtected: Story<typeof SenderTable> = {
  render: () => (
    <ControlledTable
      rows={[
        row({
          id: 'p-1',
          displayName: 'Spouse',
          domain: 'gmail.com',
          totalReceived: 432,
          monthlyVolume: 18,
          readRate: 0.98,
          volumeTrend: 'steady',
          unsubscribeMethod: 'none',
          protectionFlags: {
            isVip: true,
            isProtected: true,
            protectionReason: 'vip',
            protectionSetAt: '2025-12-01T00:00:00.000Z',
          },
        }),
      ]}
    />
  ),
};

export const SingleRow: Story<typeof SenderTable> = {
  render: () => <ControlledTable rows={[DEFAULT_ROWS[0]!]} />,
};
