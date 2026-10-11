import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

/** `OutboxDispatcherDeps.lease` is optional for tests; production must pass it. */
it('the worker gives its only outbox dispatcher the Redis lease', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../worker.ts'), 'utf8');
  const start = source.indexOf('new OutboxDispatcherWorker({');
  expect(start).toBeGreaterThan(-1);
  expect(source.indexOf('new OutboxDispatcherWorker(', start + 1)).toBe(-1);
  const deps = source.slice(start, source.indexOf('\n  });\n', start));
  expect(deps).toMatch(
    /\n {4}lease: new RedisOutboxDispatcherLease\(createRedisProducerConnection\(requireEnv\('REDIS_URL'\)\)\),\n/,
  );
});
