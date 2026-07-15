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
import { installFetchStub, jsonOk } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
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
    repliedCount: 0,
    // `in`-check (not `??`) so tests can override these to null — the
    // wire fields are nullable when the sender has no timeseries rows.
    monthlyVolume: 'monthlyVolume' in overrides ? overrides.monthlyVolume! : 61,
    readRate: 'readRate' in overrides ? overrides.readRate! : 0,
    volumeTrend: overrides.volumeTrend ?? 'steady',
    unsubscribeMethod: overrides.unsubscribeMethod ?? 'none',
    lastReview: overrides.lastReview ?? null,
    protectionFlags: overrides.protectionFlags ?? {
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
  // Stable per-mount client — the expanded row's `SenderRowDetailLive`
  // fetches the sender timeseries via TanStack Query.
  const [client] = useState(createTestQueryClient);
  return (
    <QueryWrapper client={client}>
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
    </QueryWrapper>
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

  it('row-body click toggles expansion (pointer convenience — chevron stays the accessible control)', () => {
    render(<Harness {...{}} />);
    const chevron = screen.getByRole('button', { name: /expand bank of america/i });
    expect(chevron.getAttribute('aria-expanded')).toBe('false');

    // Click a non-interactive part of the row (the sender name text).
    fireEvent.click(screen.getByText('Bank of America'));
    expect(
      screen
        .getByRole('button', { name: /collapse bank of america/i })
        .getAttribute('aria-expanded'),
    ).toBe('true');

    // Second click collapses again.
    fireEvent.click(screen.getByText('Bank of America'));
    expect(
      screen.getByRole('button', { name: /expand bank of america/i }).getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('clicks on interactive descendants do NOT toggle expansion', () => {
    render(<Harness {...{}} />);
    // Checkbox click → selection changes, row does NOT expand.
    fireEvent.click(screen.getByRole('checkbox', { name: /select bank of america/i }));
    expect(
      screen.getByRole('button', { name: /expand bank of america/i }).getAttribute('aria-expanded'),
    ).toBe('false');
    // Verb click → onAction fires elsewhere, row still does NOT expand.
    fireEvent.click(screen.getByRole('button', { name: /^keep$/i }));
    expect(
      screen.getByRole('button', { name: /expand bank of america/i }).getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('sender name carries the full address as a hover title (duplicate display names)', () => {
    render(<Harness {...{}} />);
    expect(
      screen.getByTitle('Bank of America <onlinebanking@ealerts.bankofamerica.com>'),
    ).toBeTruthy();
  });

  it('primary verb button calls onAction with the derived verb (no mutation)', () => {
    // Fixture row: unprotected, recently seen, no engine verdict →
    // `deriveDefaultPrimary` falls back to the `people` intent → Keep.
    const onAction = vi.fn();
    render(<Harness onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: /^keep$/i }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'keep', sender: expect.objectContaining({ id: 'r-1' }) }),
    );
  });

  it('row renders the shared action grammar — primary + ⋯ popover with K/A/U/L/D (ADR-0016 A5)', () => {
    const onAction = vi.fn();
    render(<Harness onAction={onAction} />);
    // No inline three-button strip anymore — one primary + one trigger.
    expect(screen.queryByRole('button', { name: /^archive$/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    const menu = screen.getByRole('menu', { name: 'Actions for Bank of America' });
    expect(menu).toBeTruthy();
    // Full registry set present as menu items.
    for (const verb of [/keep/i, /archive/i, /unsubscribe/i, /later/i, /delete/i]) {
      expect(screen.getByRole('menuitem', { name: verb })).toBeTruthy();
    }
    // A pick routes through onAction with the lowercase table verb.
    fireEvent.click(screen.getByRole('menuitem', { name: /archive/i }));
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'archive', sender: expect.objectContaining({ id: 'r-1' }) }),
    );
    // Popover self-closes after the pick.
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('popover disables destructive verbs for standing-protected rows', () => {
    render(
      <Harness
        rows={[
          row({
            protectionFlags: {
              isProtected: true,
              protectionReason: null,
              protectionSetAt: null,
            },
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    // Protected rows: Archive/Later/Unsubscribe/Delete all gated by the
    // shared capability predicates; Keep stays available.
    expect(screen.getByRole('menuitem', { name: /archive/i })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: /keep/i })).not.toBeDisabled();
  });

  it('renders the read-only Protected shield status only for protected rows', () => {
    // Unprotected row (the default) → no shield.
    const { unmount } = render(<Harness {...{}} />);
    expect(screen.queryByRole('img', { name: /protected/i })).toBeNull();
    unmount();

    // Protected row → labelled shield.
    render(
      <Harness
        rows={[
          row({
            protectionFlags: {
              isProtected: true,
              protectionReason: null,
              protectionSetAt: null,
            },
          }),
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: /^protected$/i })).toBeTruthy();
  });

  it('renders the shared fact vocabulary — read bucket + monthly cadence cell', () => {
    // readRate 0 → "Never" (amber, no pill); monthlyVolume 61 → "61/mo".
    render(<Harness {...{}} />);
    expect(screen.getByLabelText(/read rate: never marked read/i)).toHaveTextContent('Never');
    expect(screen.getByText('61/mo')).toBeTruthy();
    // Monthly is nullable — no-timeseries rows render an em-dash.
    // (Covered separately to keep this case single-row.)
  });

  it('renders em-dash monthly + read placeholders when the sender has no timeseries', () => {
    render(<Harness rows={[row({ monthlyVolume: null, readRate: null })]} />);
    // Two independent facts degrade independently to "—".
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/\/mo$/)).toBeNull();
  });

  it('checkbox toggles the selection set without mutating the input', () => {
    render(<Harness {...{}} />);
    const checkbox = screen.getByRole('checkbox', { name: /select bank of america/i });
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it('expand chevron toggles the expanded row and updates aria-expanded', async () => {
    // The expanded panel fetches the sender's real timeseries and
    // recent messages on mount.
    installFetchStub([
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/timeseries$/,
        respond: () => jsonOk({ data: [{ yearMonth: '2026-07-01', volume: 61, readCount: 3 }] }),
      },
      {
        method: 'GET',
        path: /^\/api\/senders\/[^/]+\/messages$/,
        respond: () =>
          jsonOk({
            data: [
              {
                id: 'm1',
                providerMessageId: 'prov-m1',
                providerThreadId: 'thread-m1',
                subject: 'Your statement is ready',
                snippet: 'snippet',
                internalDate: '2026-07-01T10:00:00.000Z',
                isUnread: false,
                sizeBytes: null,
              },
            ],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 10 } },
          }),
      },
    ]);
    render(<Harness {...{}} />);
    const chevron = screen.getByRole('button', { name: /expand bank of america/i });
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(chevron);
    expect(
      screen
        .getByRole('button', { name: /collapse bank of america/i })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    // Chart in the panel renders the fetched month — not fabricated bars.
    expect(await screen.findByText(/peak 61\/mo/i)).toBeTruthy();
    // Subjects card renders the fetched subject — not the old SUBJECT_POOL.
    expect(await screen.findByText('Your statement is ready')).toBeTruthy();
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
    // Column count: 10 cells per row matches COLUMNS.length.
    const first = skeletonRows[0]!;
    expect(first.children.length).toBe(10);
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
  it('relativeDate — epoch-zero dates render "—", not "56y ago"', () => {
    // Gmail reports internalDate=0 for some spam messages; the sender
    // row must not present the Unix epoch as a real last-seen fact.
    expect(__internals.relativeDate('1970-01-01T00:00:00.000Z')).toBe('—');
    expect(__internals.relativeDate('not-a-date')).toBe('—');
    // Sanity: a real recent date still renders a relative label.
    expect(__internals.relativeDate(new Date(Date.now() - 86400000).toISOString())).toBe(
      'Yesterday',
    );
  });

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
