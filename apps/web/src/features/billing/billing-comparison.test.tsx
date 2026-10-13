import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { INBOXES, METER, TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { BillingComparison, billingComparisonRows } from './billing-comparison';

describe('billing comparison rows', () => {
  it('pins Free cleanup to the live meter and keeps every row label unique', () => {
    const rows = billingComparisonRows(true);
    const cleanup = rows.find((row) => row.label === 'Cleanup / month');
    expect(cleanup?.values[0]).toBe('1,000');
    expect(cleanup?.values[0]).toBe(METER.free.limit.toLocaleString('en-US'));
    expect(cleanup?.values[0]).not.toBe(String(TIER_MANIFEST.free.cleanupActionsPerMonth));

    const inboxes = rows.find((row) => row.label === 'Connected inboxes');
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
    const cleanupRow = within(table).getByRole('row', { name: /^Cleanup \/ month/ });
    expect(within(cleanupRow).getAllByRole('cell')[0]).toHaveTextContent('1,000');
    expect(within(table).getAllByRole('rowheader', { name: 'Autopilot' })).toHaveLength(1);
  });

  it('keeps the manifest quota when launch pricing is off', () => {
    const rows = billingComparisonRows(false);
    const cleanup = rows.find((row) => row.label === 'Cleanup / month');
    expect(cleanup?.values[0]).toBe(String(TIER_MANIFEST.free.cleanupActionsPerMonth));
    const labels = rows.map((row) => row.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
