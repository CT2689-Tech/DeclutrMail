import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { assertIsolatedEnvironment } from './isolation.ts';

/** Never inherit application credentials, NODE_OPTIONS, proxies, or dotenv configuration. */
export function stackEnvironment(input) {
  assertIsolatedEnvironment(input);
  const web = new URL(input.E2E_WEB_URL);
  const api = new URL(input.E2E_API_URL);
  for (const url of [web, api]) {
    if (!url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password)
      throw new Error('E2E server URLs must be plain loopback origins with explicit ports.');
  }
  if (web.hostname !== api.hostname || web.port === api.port)
    throw new Error('E2E web/API must share a cookie hostname and use different ports.');
  const env = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP']) {
    if (input[key]) env[key] = input[key];
  }
  return {
    ...env,
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    E2E_ISOLATED: '1',
    E2E_WEB_URL: web.origin,
    E2E_API_URL: api.origin,
    DATABASE_URL: input.DATABASE_URL,
    REDIS_URL: input.REDIS_URL,
    RATE_LIMIT_ENABLED: 'false',
    JWT_ACCESS_SECRET: 'e2e-access-secret-is-longer-than-thirty-two-bytes',
    JWT_REFRESH_SECRET: 'e2e-refresh-secret-is-different-and-long-enough',
    GOOGLE_CLIENT_ID: 'e2e-google-client',
    GOOGLE_CLIENT_SECRET: 'e2e-google-secret',
    GOOGLE_REDIRECT_URI: `${api.origin}/api/auth/google/callback`,
    ENCRYPTION_LOCAL_KEY: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    DEV_AUTH_ENABLED: 'true',
    DEV_AUTH_EMAIL_PREFIX: 'chintan.e2e.',
    WEB_URL: web.origin,
    CORS_ORIGIN: web.origin,
    NEXT_PUBLIC_API_URL: api.origin,
    // No provider API/client credentials: signed synthetic webhook tests still work.
    BILLING_ENABLED: 'true',
    PADDLE_ENV: 'sandbox',
    PADDLE_WEBHOOK_SECRET: 'e2e_local_paddle_webhook_secret',
    BILLING_CATALOG_JSON: '{"paddle":{"pro_monthly":"pri_e2e_pro_monthly"}}',
    // Opt-in only for the browser suite, which intercepts the dummy-key traffic.
    NEXT_PUBLIC_POSTHOG_KEY: input.E2E_POSTHOG === '1' ? 'phc_e2e_dummy' : '',
  };
}

/** Fresh app directories keep both dotenv discovery and Next output away from the checkout. */
export function prepareStackWorkspace(repoRoot) {
  const root = mkdtempSync(path.join(tmpdir(), 'declutrmail-e2e-stack-'));
  try {
    cpSync(path.join(repoRoot, 'tsconfig.base.json'), path.join(root, 'tsconfig.base.json'));
    cpSync(path.join(repoRoot, 'package.json'), path.join(root, 'package.json'));
    symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    for (const app of ['api', 'web']) {
      const source = path.join(repoRoot, 'apps', app);
      const target = path.join(root, 'apps', app);
      mkdirSync(target, { recursive: true });
      const entries =
        app === 'api'
          ? ['src', 'package.json', 'tsconfig.json', '.swcrc']
          : [
              'src',
              'public',
              'package.json',
              'tsconfig.json',
              'next-env.d.ts',
              'next.config.ts',
              'instrumentation.ts',
              'instrumentation-client.ts',
              'sentry.server.config.ts',
              'sentry.edge.config.ts',
            ];
      for (const entry of entries) {
        if (!existsSync(path.join(source, entry))) continue;
        cpSync(path.join(source, entry), path.join(target, entry), {
          recursive: true,
          filter: (file) => !path.basename(file).startsWith('.env'),
        });
      }
      // pnpm's workspace links resolve to source packages, none of which loads dotenv.
      // App cwd, config and source remain in the temporary tree.
      symlinkSync(path.join(source, 'node_modules'), path.join(target, 'node_modules'), 'dir');
    }
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function stackCommands(root, env) {
  return [
    {
      name: 'API',
      cwd: path.join(root, 'apps/api'),
      args: ['--import', '@swc-node/register/esm-register', 'src/main.ts'],
      env: { ...env, PORT: new URL(env.E2E_API_URL).port },
    },
    {
      name: 'Web',
      cwd: path.join(root, 'apps/web'),
      args: [
        path.join(root, 'apps/web/node_modules/next/dist/bin/next'),
        'dev',
        '--hostname',
        new URL(env.E2E_WEB_URL).hostname,
        '--port',
        new URL(env.E2E_WEB_URL).port,
      ],
      env: { ...env, PORT: new URL(env.E2E_WEB_URL).port },
    },
  ];
}
