import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repo root — two levels up from packages/e2e/helpers. */
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

/**
 * Load repo-root `.env.local` into `process.env` WITHOUT overriding
 * variables already set in the environment (same precedence as the
 * api's `node --env-file-if-exists` and Next's env loading). Gives the
 * specs `DATABASE_URL` for setup/teardown without a dotenv dependency.
 */
export function loadRootEnvLocal(): void {
  const envPath = path.join(REPO_ROOT, '.env.local');
  if (!existsSync(envPath)) return;
  // Node ≥21.7; already-set environment variables win (verified on
  // Node 24: `FOO=fromenv` survives a file's `FOO=fromfile`).
  process.loadEnvFile(envPath);
}

export const E2E_ENV = {
  webUrl: process.env.E2E_WEB_URL ?? 'http://localhost:3104',
  apiUrl: process.env.E2E_API_URL ?? 'http://localhost:4104',
  loginEmail: process.env.E2E_LOGIN_EMAIL ?? 'chintan.a.thakkar@gmail.com',
  storageStatePath: path.join(HERE, '..', '.auth', 'state.json'),
} as const;
