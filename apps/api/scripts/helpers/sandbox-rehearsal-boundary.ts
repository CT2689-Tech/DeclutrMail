import { timingSafeEqual } from 'node:crypto';
/** Money-path fixture boundary: never accepts live credentials or an external DB. */
export function assertSandboxRehearsalEnvironment(env: NodeJS.ProcessEnv): void {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    !/^\d+$/.test(env.GITHUB_RUN_ID ?? '') ||
    !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? '') ||
    !/^[a-f\d]{64}$/.test(env.REHEARSAL_OPERATOR_KEY ?? '') ||
    env.BILLING_REHEARSAL !== 'sandbox' ||
    env.PADDLE_ENV !== 'sandbox' ||
    !/^pdl_sdbx_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}$/.test(env.PADDLE_API_KEY ?? '') ||
    env.DATABASE_URL !== 'postgres://postgres:postgres@127.0.0.1:5432/refund_fixture' ||
    !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(env.REHEARSAL_PUBLIC_URL ?? '')
  )
    throw new Error('Isolated GitHub sandbox rehearsal environment required');
}
export function isRehearsalOperator(value: unknown, expected: string): boolean {
  return (
    typeof value === 'string' &&
    /^[a-f\d]{64}$/.test(value) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}
export function rehearsalCase(value: string | null): 'monthly' | 'cycle' | null {
  return value === 'monthly' || value === 'cycle' ? value : null;
}
