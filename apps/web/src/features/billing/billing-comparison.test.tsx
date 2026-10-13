import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { INBOXES, METER, TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { BillingComparison, billingComparisonRows } from './billing-comparison';

describe('billing comparison rows', () => {
  it('pins Free emails cleared to the live meter and keeps every row label unique', () => {
    const rows = billingComparisonRows(true);
    const cleared = rows.find((row) => row.label === 'Emails cleared a month');
    expect(cleared?.values).toEqual([
      METER.free.limit.toLocaleString('en-US'),
      'No monthly limit',
      'No monthly limit',
    ]);
    expect(cleared?.values[0]).toBe('1,000');
    expect(cleared?.values[0]).not.toBe(String(TIER_MANIFEST.free.cleanupActionsPerMonth));

    const inboxes = rows.find((row) => row.label === 'Gmail accounts');
    expect(inboxes?.values).toEqual([
      String(INBOXES.free),
      String(INBOXES.plus),
      String(INBOXES.pro),
    ]);

    const labels = rows.map((row) => row.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter((label) => label === 'Autopilot')).toHaveLength(1);

    render(<BillingComparison pricingV2 />);
    const table = screen.getByRole('table', { name: 'Included features by plan' });
    const clearedRow = within(table).getByRole('row', { name: /^Emails cleared a month/ });
    expect(within(clearedRow).getAllByRole('cell')[0]).toHaveTextContent('1,000');
    expect(within(clearedRow).getAllByRole('cell')[1]).toHaveTextContent('No monthly limit');
    expect(within(table).getAllByRole('rowheader', { name: 'Autopilot' })).toHaveLength(1);
  });

  it('keeps meter emails-cleared values when launch pricing is off', () => {
    const rows = billingComparisonRows(false);
    const cleared = rows.find((row) => row.label === 'Emails cleared a month');
    expect(cleared?.values).toEqual([
      METER.free.limit.toLocaleString('en-US'),
      'No monthly limit',
      'No monthly limit',
    ]);
    const inboxes = rows.find((row) => row.label === 'Gmail accounts');
    expect(inboxes?.values).toEqual(
      (['free', 'plus', 'pro'] as const).map((id) => String(TIER_MANIFEST[id].inboxLimit)),
    );
    const labels = rows.map((row) => row.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
