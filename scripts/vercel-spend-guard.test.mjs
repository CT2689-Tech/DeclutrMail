import test from 'node:test';
import assert from 'node:assert/strict';
import { assessVercelSpend, readVercelBudget } from './vercel-spend-guard.mjs';

const team = 'team_fixture';
const active = {
  ownerId: team,
  scope: 'team',
  status: 'active',
  amount: '100',
  thresholds: [
    { percent: 50, sendNotifications: true, pauseUsage: false },
    { percent: 75, sendNotifications: true, pauseUsage: false },
    { percent: 100, sendNotifications: true, pauseUsage: true },
  ],
};
const read = (b = active) => readVercelBudget({ data: [b] }, team);

test('observed USD budget and cent spend reconcile with the provider CLI', () => {
  const result = assessVercelSpend(read(), { data: { currentSpend: 4939 } });
  assert.equal(result.usage.vercel_cycle_spend_usd, 49.39);
  assert.equal(result.usage.vercel_on_demand_budget_usd, 100);
  assert.equal(result.usagePct, 49);
  assert.equal(result.causes.at(-1).status, 'OK');
});

test('warnings follow configured notifications and breach precedes a production pause', () => {
  for (const [currentSpend, status] of [
    [5000, 'WARN'],
    [9999, 'WARN'],
    [10000, 'BREACH'],
  ])
    assert.equal(
      assessVercelSpend(read(), { data: { currentSpend } }).causes.at(-1).status,
      status,
    );
  const earlier = read({
    ...active,
    thresholds: [
      { percent: 25, sendNotifications: true, pauseUsage: false },
      { percent: 75, sendNotifications: true, pauseUsage: true },
    ],
  });
  assert.equal(
    assessVercelSpend(earlier, { data: { currentSpend: 7500 } }).causes.at(-1).status,
    'BREACH',
  );
});

test('a disabled, absent or differently scoped budget never reads as protected', () => {
  for (const b of [
    { ...active, ownerId: 'team_other' },
    { ...active, scope: 'project' },
    { ...active, status: 'disabled' },
  ])
    assert.equal(read(b).causes[0].status, 'BREACH');
  const noPause = read({
    ...active,
    thresholds: active.thresholds.map((t) => ({ ...t, pauseUsage: false })),
  });
  assert.match(noPause.causes[0].text, /auto-pause/);
  const noAdvance = read({ ...active, thresholds: [active.thresholds[2]] });
  assert.match(noAdvance.causes[0].text, /notification before/);
});

test('missing or malformed provider data stays unavailable, including absent spend', () => {
  for (const response of [null, {}, { data: null }, { data: [active, active] }])
    assert.throws(() => readVercelBudget(response, team));
  for (const amount of [null, '', true, -1, 'Infinity', '0', '100.001'])
    assert.throws(() => read({ ...active, amount }));
  for (const thresholds of [
    null,
    [],
    [{ percent: 50, sendNotifications: 'true', pauseUsage: false }],
  ])
    assert.throws(() => read({ ...active, thresholds }));
  for (const currentSpend of [null, undefined, '', true, '4939', -1, 0.1, Infinity])
    assert.throws(() => assessVercelSpend(read(), { data: { currentSpend } }));
  assert.equal(
    assessVercelSpend(read(), { data: { currentSpend: 0 } }).usage.vercel_cycle_spend_usd,
    0,
  );
});
