import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertIsolatedEnvironment } from '../helpers/isolation.ts';

const safe = {
  E2E_ISOLATED: '1',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/declutrmail_e2e',
  REDIS_URL: 'redis://127.0.0.1:6379/12',
  E2E_WEB_URL: 'http://127.0.0.1:3104',
  E2E_API_URL: 'http://127.0.0.1:4104',
};
test('accepts an explicit disposable local stack', () =>
  assert.doesNotThrow(() => assertIsolatedEnvironment(safe)));
for (const [key, value] of [
  ['E2E_ISOLATED', undefined],
  ['DATABASE_URL', 'postgresql://u:p@localhost:5432/declutrmail'],
  ['DATABASE_URL', 'postgresql://u:p@remote.example:5432/declutrmail_e2e'],
  ['DATABASE_URL', 'postgresql://u:p@localhost:5432/declutrmail_e2e?database=declutrmail'],
  ['DATABASE_URL', 'postgresql://u:p@localhost:5432/declutrmail_e2e#override'],
  ['REDIS_URL', 'redis://localhost:6379/0'],
  ['REDIS_URL', 'redis://localhost:6379/12?path=/tmp/another-redis.sock'],
  ['REDIS_URL', 'redis://localhost:6379/12?db=0'],
  ['REDIS_URL', 'redis://localhost:6379/12#override'],
  ['E2E_API_URL', 'https://declutrmail.com'],
  ['E2E_WEB_URL', 'http://remote.example:3104'],
  ['E2E_LOGIN_EMAIL', 'person@gmail.com'],
  ['E2E_BILLING_LOGIN_EMAIL', 'person@gmail.com'],
])
  test(`rejects unsafe ${key}: ${value}`, () =>
    assert.throws(() => assertIsolatedEnvironment({ ...safe, [key]: value })));
