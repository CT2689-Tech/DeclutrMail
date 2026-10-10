import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import {
  assertSandboxRehearsalEnvironment,
  rehearsalCase,
  isRehearsalOperator,
  REHEARSAL_LISTEN_PORT,
  listenRehearsalServer,
} from '../../../scripts/helpers/sandbox-rehearsal-boundary.js';
const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_RUN_ID: '12345',
  GITHUB_RUN_ATTEMPT: '1',
  REHEARSAL_OPERATOR_KEY: 'c'.repeat(64),
  BILLING_REHEARSAL: 'sandbox',
  PADDLE_ENV: 'sandbox',
  PADDLE_API_KEY: `pdl_sdbx_apikey_${'a'.repeat(26)}_${'b'.repeat(22)}_abc`,
  DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/refund_fixture',
  REHEARSAL_PUBLIC_URL: 'https://synthetic-fixture.trycloudflare.com',
};
describe('sandbox financial rehearsal boundary', () => {
  it('reaches a denied HTTP response using the configured runtime port', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(403);
      res.end('private_operator_required');
    });
    await listenRehearsalServer(server);
    try {
      const response = await fetch(`http://127.0.0.1:${REHEARSAL_LISTEN_PORT}/state?case=monthly`);
      expect(response.status).toBe(403);
      expect(await response.text()).toBe('private_operator_required');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it('rejects an occupied port into cleanup instead of crashing the process', async () => {
    const blocker = createServer();
    await listenRehearsalServer(blocker);
    const fixture = createServer();
    let cleanupReached = false;
    try {
      await expect(
        (async () => {
          try {
            await listenRehearsalServer(fixture);
          } finally {
            cleanupReached = true;
          }
        })(),
      ).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(cleanupReached).toBe(true);
      expect(fixture.listening).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) =>
        blocker.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it('accepts only the isolated sandbox context', () =>
    expect(() => assertSandboxRehearsalEnvironment(env)).not.toThrow());
  it.each([
    { PADDLE_ENV: 'production' },
    { PADDLE_API_KEY: 'pdl_live_apikey_example' },
    { DATABASE_URL: 'postgres://prod.example/customer' },
    { GITHUB_ACTIONS: 'false' },
    { GITHUB_RUN_ID: '' },
    { GITHUB_RUN_ATTEMPT: '' },
    { REHEARSAL_OPERATOR_KEY: '' },
    { REHEARSAL_PUBLIC_URL: 'https://declutrmail.com' },
    { BILLING_REHEARSAL: 'production' },
  ])('refuses %j before provider I/O', (override) =>
    expect(() => assertSandboxRehearsalEnvironment({ ...env, ...override })).toThrow(),
  );
  it('has only two fixed synthetic scenarios', () => {
    expect(rehearsalCase('monthly')).toBe('monthly');
    expect(rehearsalCase('cycle')).toBe('cycle');
    expect(rehearsalCase('sub_external')).toBeNull();
  });
  it('refuses missing, forged and malformed operator keys', () => {
    expect(isRehearsalOperator(undefined, env.REHEARSAL_OPERATOR_KEY)).toBe(false);
    expect(isRehearsalOperator('d'.repeat(64), env.REHEARSAL_OPERATOR_KEY)).toBe(false);
    expect(isRehearsalOperator('c', env.REHEARSAL_OPERATOR_KEY)).toBe(false);
    expect(isRehearsalOperator(env.REHEARSAL_OPERATOR_KEY, env.REHEARSAL_OPERATOR_KEY)).toBe(true);
  });
});
