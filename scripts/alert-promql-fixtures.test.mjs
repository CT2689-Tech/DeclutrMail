import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  coverageNotifications,
  workerOutageQuery,
  reconnectBurstPolicy,
  COVERAGE_POLICY,
} from './alert-notification-policy.mjs';
import { infrastructurePolicies } from './setup-infra-alerts.mjs';
import { EXPECTED_RUNTIME_COLLECTIONS } from './infra-runtime-metrics.mjs';

const fixturePath = 'scripts/fixtures/alert-promql.test.yml';

test('committed promtool fixtures execute the routing expressions', () => {
  const fixture = readFileSync(fixturePath, 'utf8');
  const coverage = coverageNotifications(
    infrastructurePolicies({ runtime: true }).find((p) => p.displayName === COVERAGE_POLICY),
    'worker-check',
  ).conditions[0].conditionPrometheusQueryLanguage.query;
  for (const expr of [
    workerOutageQuery('worker-check'),
    coverage,
    reconnectBurstPolicy().conditions[0].conditionPrometheusQueryLanguage.query,
  ])
    assert.ok(fixture.includes(expr));
  // Absent sources each contribute 1. The committed expected value has to move with them.
  assert.equal(EXPECTED_RUNTIME_COLLECTIONS.length, 10);
  assert.equal((fixture.match(/- expr: \|-/g) ?? []).length, 10);
  const names = [
    'absent',
    'sparse',
    'mixed',
    'one-location',
    'two-locations',
    'reconnect-zero',
    'reconnect-one',
    'reconnect-two',
  ];
  for (const name of names) assert.match(fixture, new RegExp(`name: ${name}\\b`));
  const promtool = process.env.PROMTOOL ?? 'promtool';
  const result = spawnSync(promtool, ['test', 'rules', fixturePath], { encoding: 'utf8' });
  if (result.error)
    assert.fail(`promtool is required to run ${fixturePath} (${result.error.message})`);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
