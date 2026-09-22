/** Fail closed before any fixture write or authentication. No root .env.local inheritance. */
export function assertIsolatedEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.E2E_ISOLATED !== '1') throw new Error('Set E2E_ISOLATED=1 for a disposable E2E stack.');
  const local = (value: string | undefined, name: string): URL => {
    if (!value) throw new Error(`${name} must be explicitly set for the isolated E2E stack.`);
    const url = new URL(value);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error(`${name} must use a loopback host; remote test targets are forbidden.`);
    }
    // Drivers interpret query parameters independently of URL.pathname:
    // postgres.js accepts ?database=..., and ioredis accepts ?path=... .
    // Neither may redirect an otherwise valid disposable target.
    if (url.search || url.hash) {
      throw new Error(`${name} must not contain query options or fragments.`);
    }
    return url;
  };
  const db = local(env.DATABASE_URL, 'DATABASE_URL');
  if (
    !['postgres:', 'postgresql:'].includes(db.protocol) ||
    !/^\/declutrmail_e2e(?:_[a-z0-9_]+)?$/.test(db.pathname)
  ) {
    throw new Error('DATABASE_URL must select a dedicated declutrmail_e2e database.');
  }
  const redis = local(env.REDIS_URL, 'REDIS_URL');
  if (redis.protocol !== 'redis:' || redis.pathname !== '/12') {
    throw new Error('REDIS_URL must select the isolated E2E Redis database /12.');
  }
  for (const key of ['E2E_WEB_URL', 'E2E_API_URL'] as const) {
    if (local(env[key], key).protocol !== 'http:') throw new Error(`${key} must use local HTTP.`);
  }
  for (const key of ['E2E_LOGIN_EMAIL', 'E2E_BILLING_LOGIN_EMAIL'] as const) {
    if (env[key] && env[key] !== 'chintan.e2e.billing@synthetic.test') {
      throw new Error(`${key} must be the fixed synthetic fixture identity.`);
    }
  }
}
