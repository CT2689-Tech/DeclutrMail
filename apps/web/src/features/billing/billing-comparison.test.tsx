import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { INBOXES, METER } from '@declutrmail/shared/entitlements';

import { BillingComparison, billingComparisonRows } from './billing-comparison';

describe('billing comparison rows', () => {
  it('pins Free emails cleared to the live meter and keeps every row label unique', () => {
    const rows = billingComparisonRows();
    const cleared = rows.find((row) => row.label === 'Emails cleared a month');
    expect(cleared?.values).toEqual([
      METER.free.limit.toLocaleString('en-US'),
      'No monthly limit',
      'No monthly limit',
    ]);
    expect(cleared?.values[0]).toBe('1,000');

    const inboxes = rows.find((row) => row.label === 'Gmail accounts');
    expect(inboxes?.values).toEqual([
      String(INBOXES.free),
      String(INBOXES.plus),
      String(INBOXES.pro),
    ]);

    const labels = rows.map((row) => row.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter((label) => label === 'Autopilot')).toHaveLength(1);

    render(<BillingComparison />);
    const table = screen.getByRole('table', { name: 'Included features by plan' });
    const clearedRow = within(table).getByRole('row', { name: /^Emails cleared a month/ });
    expect(within(clearedRow).getAllByRole('cell')[0]).toHaveTextContent('1,000');
    expect(within(clearedRow).getAllByRole('cell')[1]).toHaveTextContent('No monthly limit');
    expect(within(table).getAllByRole('rowheader', { name: 'Autopilot' })).toHaveLength(1);
  });

  it('groups universal features and keeps plan differences in the table', () => {
    render(<BillingComparison />);
    const shared = screen.getByText('Included on every plan:').parentElement!;
    const table = screen.getByRole('table', { name: 'Included features by plan' });
    for (const row of billingComparisonRows()) {
      if (row.values.every((value) => value === 'Included')) {
        expect(shared).toHaveTextContent(row.label);
        expect(within(table).queryByRole('rowheader', { name: row.label })).not.toBeInTheDocument();
      } else {
        expect(within(table).getByRole('rowheader', { name: row.label })).toBeInTheDocument();
      }
    }
  });
});
