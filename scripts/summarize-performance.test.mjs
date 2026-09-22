import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizePerformance } from './summarize-performance.mjs';

test('separates status classes, excludes probes, and summarizes sampled operations', () => {
  const rows = [10, 20, 30, 100].map((durationMs) => ({
    jsonPayload: { kind: 'http.request', route: 'GET /api/senders/:id', status: 200, durationMs },
  }));
  rows[0].jsonPayload.operations = {
    'auth.sync-state': { count: 1, durationMs: 4 },
    unknown: { count: 1, durationMs: 999 },
  };
  rows.push({
    jsonPayload: {
      kind: 'http.request',
      route: 'GET /api/senders/:id',
      status: 500,
      durationMs: 600,
    },
  });
  rows.push({
    jsonPayload: { kind: 'http.request', route: 'GET /api/healthz', status: 200, durationMs: 1 },
  });
  const result = summarizePerformance(JSON.stringify(rows));
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    route: 'GET /api/senders/:id',
    status: '2xx',
    samples: 4,
    p50Ms: 20,
    p95Ms: 100,
    p99Ms: 100,
    maxMs: 100,
    operations: { 'auth.sync-state': { samples: 1, p50Ms: 4, p95Ms: 4, p99Ms: 4, maxMs: 4 } },
  });
  assert.equal(result[1].status, '5xx');
});

test('ignores nonmetric lines and never copies arbitrary log fields or raw URLs', () => {
  const result = summarizePerformance(
    [
      'server started',
      JSON.stringify({
        kind: 'http.request',
        route: 'GET /api/senders?q=private@example.test',
        status: 200,
        durationMs: 500,
      }),
      JSON.stringify({
        kind: 'http.request',
        route: 'GET /api/senders',
        status: 200,
        durationMs: 20,
        cid: 'private',
        error: 'private@example.test',
      }),
      JSON.stringify({
        kind: 'http.request',
        route: 'GET /api/senders',
        status: 200,
        durationMs: -1,
      }),
    ].join('\n'),
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].samples, 1);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.deepEqual(summarizePerformance('null'), []);
});
