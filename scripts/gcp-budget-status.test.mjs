import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetStatus } from './gcp-budget-status.mjs';
const budget = {
  displayName: 'test',
  amount: { specifiedAmount: { currencyCode: 'USD', units: '20' } },
  budgetFilter: {
    calendarPeriod: 'MONTH',
    projects: ['projects/387835380133'],
    creditTypesTreatment: 'INCLUDE_ALL_CREDITS',
  },
};
const period = {
  budgetPeriodStart: Date.parse('2026-09-01T07:00:00Z'),
  budgetPeriodEnd: Date.parse('2026-10-01T07:00:00Z'),
};
const now = new Date('2026-09-24T12:00:00Z');
test('existing budget cannot mask overspend', () =>
  assert.equal(
    budgetStatus([budget], { ...period, status: 'OK', costMtdUsd: 77.6 }, now).status,
    'BREACH',
  ));
test('unavailable spend and mismatching filters never pass', () => {
  assert.equal(budgetStatus([budget], { status: 'WARN' }, now).status, 'WARN');
  assert.equal(
    budgetStatus(
      [{ ...budget, budgetFilter: { ...budget.budgetFilter, services: ['services/a'] } }],
      { ...period, status: 'OK', costMtdUsd: 1 },
      now,
    ).status,
    'WARN',
  );
});
test('forecast warns before actual limit; nanos honored', () => {
  assert.equal(
    budgetStatus([budget], { ...period, status: 'OK', costMtdUsd: 18 }, now).status,
    'WARN',
  );
  assert.equal(
    budgetStatus(
      [
        {
          ...budget,
          amount: { specifiedAmount: { currencyCode: 'USD', units: '20', nanos: 500000000 } },
        },
      ],
      { ...period, status: 'OK', costMtdUsd: 20.2 },
      now,
    ).status,
    'WARN',
  );
});

test('wrong billing period and ancestor filters cannot pass', () => {
  assert.equal(budgetStatus([budget], { status: 'OK', costMtdUsd: 1 }, now).status, 'WARN');
  assert.equal(
    budgetStatus(
      [
        {
          ...budget,
          budgetFilter: { ...budget.budgetFilter, resourceAncestors: ['organizations/a'] },
        },
      ],
      { ...period, status: 'OK', costMtdUsd: 1 },
      now,
    ).status,
    'WARN',
  );
});
