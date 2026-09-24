import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkSenderRelease, validateSenderContract } from './check-sender-release-contract.mjs';

const options = {
  origin: 'https://api.example.test',
  senderId: '11111111-1111-1111-1111-111111111111',
  cookie: 'dm_access=private',
};

test('rejects the production regression: old API lacks archivedCount', () => {
  assert.throws(() => validateSenderContract({ data: { inboxCount: 551 } }), /archivedCount/);
  validateSenderContract({ data: { inboxCount: 551, archivedCount: 872 } });
  validateSenderContract({ data: { inboxCount: 0, archivedCount: 0 } });
});
test('empty, malformed, negative, null and unsafe counts never pass', () => {
  for (const body of [undefined, {}, { data: null }, { data: {} }])
    assert.throws(() => validateSenderContract(body));
  for (const field of ['inboxCount', 'archivedCount']) {
    for (const value of [null, -1, 0.5, '12', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() =>
        validateSenderContract({ data: { inboxCount: 1, archivedCount: 2, [field]: value } }),
      );
    }
  }
});
test('verifies authenticated detail and returns only timing and contract verdict', async () => {
  const result = await checkSenderRelease({
    ...options,
    fetchImpl: async (url, init) => {
      assert.equal(url.pathname, `/api/senders/${options.senderId}`);
      assert.equal(init.headers.Cookie, options.cookie);
      assert.equal(init.redirect, 'error');
      return new Response(
        JSON.stringify({
          data: { inboxCount: 1, archivedCount: 2, email: 'private@example.test' },
        }),
      );
    },
  });
  assert.deepEqual(Object.keys(result).sort(), ['contract', 'durationMs', 'verified']);
  assert.equal(result.verified, true);
});
test('authentication failures, missing senders, outages and empty bodies fail', async () => {
  for (const status of [401, 403, 404, 500]) {
    await assert.rejects(
      checkSenderRelease({
        ...options,
        fetchImpl: async () => new Response('private', { status }),
      }),
    );
  }
  await assert.rejects(checkSenderRelease({ ...options, fetchImpl: async () => new Response('') }));
  await assert.rejects(
    checkSenderRelease({
      ...options,
      fetchImpl: async () => {
        throw new Error('network');
      },
    }),
  );
});
test('refuses insecure origins and malformed input before transmitting credentials', async () => {
  for (const change of [
    { origin: 'http://api.example.test' },
    { origin: 'https://user:pass@example.test' },
    { origin: 'https://example.test/private?q=secret' },
    { senderId: '../secret' },
    { cookie: '' },
    { cookie: 'foo\nbar' },
  ]) {
    await assert.rejects(
      checkSenderRelease({
        ...options,
        ...change,
        fetchImpl: async () => assert.fail('must not fetch'),
      }),
    );
  }
});
