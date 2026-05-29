/**
 * SenderTable unit tests — Slice 1 / Step 6 (ADR-0014).
 *
 * Asserts the structural + accessibility + interaction contracts:
 *
 *   1. Semantic table: `<table>` + `<thead>` + sortable `<th>` headers
 *      carry `aria-sort` on the active column and `none` elsewhere.
 *   2. Header click toggles direction on the active column, sets the
 *      sane per-column default on an inactive column.
 *   3. Row is NOT `role="button"` — chevron is the dedicated expand
 *      control. Verbs are siblings, not row-wrapped clickables.
 *   4. Verbs route through `onAction` (no optimistic mutation): the
 *      table NEVER mutates the row; it only emits.
 *   5. Selection: checkbox toggles selectedIds in/out of the set.
 *   6. Magnitude bar suppressed when `globalMaxTotal === 0`.
 *   7. Loading skeleton preserves the column count.
 *   8. Error row shows retry; empty trio renders correct copy per kind.
 *   9. `nextSortFor` + `toggleSelection` pure-helpers exposed via
 *      `__internals` round-trip cleanly (regression seam).
 */

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { SenderListRow, SenderListDirection, SenderListSort } from '@/lib/api/senders';
import { SenderTable, type SenderTableProps } from './sender-table';
import { __internals } from './sender-table';

function row(overrides: Partial<SenderListRow> = {}): SenderListRow {
  return {
    id: overrides.id ?? 'r-1',
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

function Harness(initial: Partial<SenderTableProps>) {
  const [sort, setSort] = useState<SenderListSort>(initial.sort ?? 'total');
  const [direction, setDirection] = useState<SenderListDirection>(initial.direction ?? 'desc');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    initial.selectedIds ?? new Set(),
  );
  return (
    <SenderTable
      rows={initial.rows ?? [row()]}
      globalMaxTotal={initial.globalMaxTotal ?? 6471}
      sort={sort}
      direction={direction}
      onSortChange={(next) => {
        setSort(next.sort);
        setDirection(next.direction);
      }}
      selectedIds={selectedIds}
      onSelectionChange={setSelectedIds}
      onAction={initial.onAction ?? (() => {})}
      loading={initial.loading}
      error={initial.error}
      onRetry={initial.onRetry}
      emptyKind={initial.emptyKind}
      density={initial.density}
    />
  );
}

describe('SenderTable', () => {
  it('renders a semantic <table> with sortable <th> headers carrying aria-sort', () => {
    const { container } = render(<Harness {...{}} />);
    expect(container.querySelector('table')).toBeTruthy();
    // Default sort = total DESC.
    const totalHeader = screen.getByRole('columnheader', { name: /total/i });
    expect(totalHeader.getAttribute('aria-sort')).toBe('descending');
    // Non-active sortable column carries aria-sort="none".
    const nameHeader = screen.getByRole('columnheader', { name: /sender/i });
    expect(nameHeader.getAttribute('aria-sort')).toBe('none');
  });

  it('toggles direction when the active sortable header is clicked', () => {
    render(<Harness sort="total" direction="desc" />);
    const totalButton = screen.getByRole('button', { name: /^total/i });
    fireEvent.click(totalButton);
    // Re-query: state has flipped to ascending.
    expect(screen.getByRole('columnheader', { name: /total/i }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
  });

  it('switching to an inactive column adopts that column default direction', () => {
    render(<Harness sort="total" direction="desc" />);
    const nameButton = screen.getByRole('button', { name: /^sender/i });
    fireEvent.click(nameButton);
    // Name's default direction is `asc`.
    expect(screen.getByRole('columnheader', { name: /sender/i }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
  });

  it('does NOT mark the row as role=button (chevron is the dedicated expand control)', () => {
    render(<Harness {...{}} />);
    // The data-row has no role attribute.
    const tr = document.querySelector('tr[data-dm-sender-id]') as HTMLElement | null;
    expect(tr).not.toBeNull();
    expect(tr!.getAttribute('role')).toBeNull();
    // There IS a dedicated expand button.
    expect(screen.getByRole('button', { name: /expand bank of america/i })).toBeTruthy();
  });

  it('verb buttons call onAction with the correct verb + sender row (no mutation)', () => {
    const onAction = vi.fn();
    render(<Harness onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: /^archive bank of america/i }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'archive', sender: expect.objectContaining({ id: 'r-1' }) }),
    );
  });

  it('checkbox toggles the selection set without mutating the input', () => {
    render(<Harness {...{}} />);
    const checkbox = screen.getByRole('checkbox', { name: /select bank of america/i });
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it('expand chevron toggles the expanded row and updates aria-expanded', () => {
    render(<Harness {...{}} />);
    const chevron = screen.getByRole('button', { name: /expand bank of america/i });
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(chevron);
    expect(
      screen
        .getByRole('button', { name: /collapse bank of america/i })
        .getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('suppresses the magnitude bar when globalMaxTotal is 0', () => {
    const { container } = render(<Harness rows={[row({ totalReceived: 0 })]} globalMaxTotal={0} />);
    // The bar is the only aria-hidden span inside the Total cell with a
    // width style — querying by attribute is the cheapest stable seam.
    const bars = container.querySelectorAll('span[aria-hidden="true"]');
    // No fixed-width 120px bar should be present when max is 0.
    for (const bar of Array.from(bars)) {
      const style = (bar as HTMLElement).style;
      expect(style.width).not.toBe('120px');
    }
  });

  it('renders a loading skeleton with the same column count as a real row', () => {
    const { container } = render(<Harness rows={[]} loading={true} />);
    const skeletonRows = container.querySelectorAll('tr[data-dm-sender-skeleton]');
    expect(skeletonRows.length).toBeGreaterThan(0);
    // Column count: 9 cells per row matches COLUMNS.length.
    const first = skeletonRows[0]!;
    expect(first.children.length).toBe(9);
  });

  it('renders an error row with retry when error + onRetry are provided', () => {
    const onRetry = vi.fn();
    render(<Harness rows={[]} error={{ message: 'Network down' }} onRetry={onRetry} />);
    expect(screen.getByText(/network down/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders distinct empty copy per emptyKind', () => {
    const { rerender } = render(<Harness rows={[]} emptyKind="no-senders" />);
    expect(screen.getByText(/no senders yet/i)).toBeTruthy();
    rerender(<Harness rows={[]} emptyKind="no-filter-match" />);
    expect(screen.getByText(/no senders match this filter/i)).toBeTruthy();
    rerender(<Harness rows={[]} emptyKind="no-search-match" />);
    expect(screen.getByText(/no matches/i)).toBeTruthy();
  });

  it('falls back to email when displayName is empty', () => {
    render(<Harness rows={[row({ displayName: '', email: 'fallback@example.com' })]} />);
    expect(screen.getByText('fallback@example.com')).toBeTruthy();
  });
});

describe('SenderTable / __internals', () => {
  it('nextSortFor — flips direction when the same column is clicked', () => {
    expect(__internals.nextSortFor('total', true, 'desc')).toEqual({
      sort: 'total',
      direction: 'asc',
    });
    expect(__internals.nextSortFor('total', true, 'asc')).toEqual({
      sort: 'total',
      direction: 'desc',
    });
  });

  it('nextSortFor — switching to an inactive column applies the per-column default', () => {
    // Switching to `name` from inactive → defaults to asc.
    expect(__internals.nextSortFor('name', false, 'desc')).toEqual({
      sort: 'name',
      direction: 'asc',
    });
    // Switching to `total` from inactive → defaults to desc.
    expect(__internals.nextSortFor('total', false, 'asc')).toEqual({
      sort: 'total',
      direction: 'desc',
    });
  });

  it('toggleSelection — adds when checked, removes when unchecked, no input mutation', () => {
    const before = new Set(['a', 'b']);
    let emitted: ReadonlySet<string> | null = null;
    __internals.toggleSelection(before, 'c', true, (next) => (emitted = next));
    expect(Array.from(emitted!).sort()).toEqual(['a', 'b', 'c']);
    // Input set unchanged.
    expect(Array.from(before).sort()).toEqual(['a', 'b']);

    __internals.toggleSelection(before, 'a', false, (next) => (emitted = next));
    expect(Array.from(emitted!)).toEqual(['b']);
  });

  it('displayLabel — falls back to email when displayName is empty', () => {
    expect(
      __internals.displayLabel({
        displayName: '',
        email: 'fallback@x.com',
      } as SenderListRow),
    ).toBe('fallback@x.com');
    expect(
      __internals.displayLabel({
        displayName: 'Acme',
        email: 'a@x.com',
      } as SenderListRow),
    ).toBe('Acme');
  });
});
