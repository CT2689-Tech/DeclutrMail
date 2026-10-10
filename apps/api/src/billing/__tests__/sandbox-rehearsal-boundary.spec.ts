import { describe, expect, it } from 'vitest';
import {
  assertSandboxRehearsalEnvironment,
  rehearsalCase,
  isRehearsalOperator,
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
