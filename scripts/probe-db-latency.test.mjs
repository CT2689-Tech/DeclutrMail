import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { probeDbLatency } from './probe-db-latency.mjs';

function fakeClient(query) {
  let released = false;
  query.release = () => {
    released = true;
  };
  return { reserve: async () => query, released: () => released };
}
test('records server planning/execution separately and releases the one connection', async () => {
  let calls = 0;
  const client = fakeClient(async (query) => {
    assert.equal(query.join(''), 'EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1');
    calls++;
    return [{ 'QUERY PLAN': [{ 'Planning Time': 0.02, 'Execution Time': 0.01 }] }];
  });
  const result = await probeDbLatency(client, 3);
  assert.equal(calls, 3);
  assert.equal(result.samples, 3);
  assert.equal(result.serverExecution.p95Ms, 0.01);
  assert.ok(result.outsideServer.p50Ms >= 0);
  assert.equal(client.released(), true);
});
test('query failures and empty evidence fail, while releasing the connection', async () => {
  for (const query of [
    async () => [],
    async () => {
      throw new Error('private database error');
    },
  ]) {
    const client = fakeClient(query);
    await assert.rejects(probeDbLatency(client));
    assert.equal(client.released(), true);
  }
});
test('never starts unbounded or empty probes', async () => {
  for (const samples of [0, -1, 101, 1.5, NaN]) {
    await assert.rejects(
      probeDbLatency({ reserve: () => assert.fail('must not connect') }, samples),
    );
  }
});
