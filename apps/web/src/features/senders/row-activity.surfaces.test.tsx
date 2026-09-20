// One activity model, three layouts. The row the user acted on must say
// so in the table, the grid AND the phone list — the founder's report was
// made in the TABLE layout, which had no busy state at all.
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import type { SenderListRow } from '@/lib/api/senders';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { SenderActionRow } from './action-row';
import { rollupByDomain } from './domain-rollup';
import { SenderCard } from './grid/sender-card';
import { SenderGrid } from './grid/sender-grid';
import { RowActivityProvider, type RowActivityById } from './row-activity';
import { SenderTable } from './sender-table';
import { SenderListRow as SenderRowMobile } from './table/sender-list-row';
import { makeSender } from './testing/make-sender';

vi.mock('./grid/sender-peek', () => ({ SenderPeek: () => null }));

const sender = makeSender({ id: 'sender-1', displayName: 'Yankee Candle' });
const working: RowActivityById = new Map([['sender-1', { phase: 'working', verb: 'delete' }]]);
const done: RowActivityById = new Map([
  ['sender-1', { phase: 'done', verb: 'delete', affectedCount: 251 }],
]);

function Wrap({ activity, children }: { activity: RowActivityById; children: React.ReactNode }) {
  const [client] = useState(createTestQueryClient);
  return (
    <QueryWrapper client={client}>
      <RowActivityProvider value={activity}>{children}</RowActivityProvider>
    </QueryWrapper>
  );
}

describe('SenderActionRow — a busy sender takes no second action', () => {
  it('turns the primary verb and the ⋯ menu inert while its job runs — but keeps them focusable', () => {
    const onAction = vi.fn();
    render(
      <Wrap activity={working}>
        <SenderActionRow sender={sender} onAction={onAction} />
      </Wrap>,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const b of buttons) {
      // `aria-disabled`, not native `disabled`: a natively disabled
      // control drops out of the tab order, and the one that just had
      // focus (the verb the user pressed) would throw focus to <body>.
      expect(b).toHaveAttribute('aria-disabled', 'true');
      expect(b).not.toBeDisabled();
      b.focus();
      expect(b).toHaveFocus();
      fireEvent.click(b);
    }
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('re-enables once the job is done', () => {
    render(
      <Wrap activity={done}>
        <SenderActionRow sender={sender} onAction={() => {}} />
      </Wrap>,
    );
    for (const b of screen.getAllByRole('button')) expect(b).not.toHaveAttribute('aria-disabled');
  });
});

describe('grid card', () => {
  const card = (activity: RowActivityById) =>
    render(
      <Wrap activity={activity}>
        <SenderCard
          sender={sender}
          selected={false}
          onToggleSelect={() => {}}
          onAction={() => {}}
          globalMaxTotal={500}
        />
      </Wrap>,
    );

  it('reads as busy: pill, aria-busy, checkbox off', () => {
    card(working);
    const root = screen.getByTestId('sender-card-sender-1');
    expect(root).toHaveAttribute('aria-busy', 'true');
    expect(within(root).getByText('Moving to Trash…')).toBeInTheDocument();
    expect(within(root).getByRole('checkbox')).toBeDisabled();
  });

  it('stays, marked done with the real count', () => {
    card(done);
    const root = screen.getByTestId('sender-card-sender-1');
    expect(root).not.toHaveAttribute('aria-busy', 'true');
    expect(within(root).getByText('Deleted · 251 emails')).toBeInTheDocument();
  });
});

describe('table row', () => {
  const rowWire = { ...sender, displayName: 'Yankee Candle' } as unknown as SenderListRow;
  const table = (activity: RowActivityById) =>
    render(
      <Wrap activity={activity}>
        <SenderTable
          rows={[rowWire]}
          globalMaxTotal={500}
          sort="total"
          direction="desc"
          onSortChange={() => {}}
          selectedIds={new Set()}
          onSelectionChange={() => {}}
          onRowToggle={() => {}}
          onAction={() => {}}
        />
      </Wrap>,
    );

  it('reads as busy in the TABLE layout — the one the report was made in', () => {
    table(working);
    const pill = screen.getByText('Moving to Trash…');
    const tr = pill.closest('tr')!;
    expect(tr).toHaveAttribute('aria-busy', 'true');
    expect(within(tr).getByRole('checkbox')).toBeDisabled();
  });

  it('stays, marked done', () => {
    table(done);
    expect(screen.getByText('Deleted · 251 emails')).toBeInTheDocument();
  });
});

describe('phone row', () => {
  it('reads as busy', () => {
    render(
      <Wrap activity={working}>
        <SenderRowMobile
          s={sender}
          selected={false}
          expanded={false}
          onToggleSelect={() => {}}
          onToggleExpand={() => {}}
          onAction={() => {}}
        />
      </Wrap>,
    );
    expect(screen.getByText('Moving to Trash…')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});

describe('collapsed brand group (grid)', () => {
  // A brand with ≥3 senders collapses into one card. Act on its members,
  // collapse it, and the founder's original complaint was fully intact:
  // nothing on screen said anything was happening.
  const members = ['g1', 'g2', 'g3'].map((id, i) =>
    makeSender({ id, displayName: `Brand ${i}`, email: `n${i}@brand.com`, domain: 'brand.com' }),
  );
  const group = (activity: RowActivityById) =>
    render(
      <Wrap activity={activity}>
        <SenderGrid
          entries={rollupByDomain(members)}
          selectedIds={new Set()}
          onToggleSelect={() => {}}
          onAction={() => {}}
          globalMaxTotal={500}
        />
      </Wrap>,
    );

  it('says how many members are working, and reads as busy', () => {
    group(
      new Map([
        ['g1', { phase: 'working', verb: 'archive' }],
        ['g2', { phase: 'working', verb: 'archive' }],
      ]),
    );
    const card = screen.getByTestId('domain-group-brand.com');
    expect(card).toHaveAttribute('aria-busy', 'true');
    expect(within(card).getByText('2 working…')).toBeInTheDocument();
  });

  it('says how many are done once nothing is working', () => {
    group(
      new Map([
        ['g1', { phase: 'done', verb: 'archive', affectedCount: null }],
        ['g2', { phase: 'failed', verb: 'archive' }],
      ]),
    );
    const card = screen.getByTestId('domain-group-brand.com');
    expect(card).not.toHaveAttribute('aria-busy');
    expect(within(card).getByText('1 done · 1 failed')).toBeInTheDocument();
  });

  it('says nothing when no member was acted on', () => {
    group(new Map());
    expect(document.querySelector('[data-dm-group-activity]')).toBeNull();
  });
});
