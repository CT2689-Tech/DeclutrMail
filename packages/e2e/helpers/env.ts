import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repo root — two levels up from packages/e2e/helpers. */
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

export const E2E_ENV = {
  webUrl: process.env.E2E_WEB_URL ?? 'http://localhost:3104',
  apiUrl: process.env.E2E_API_URL ?? 'http://localhost:4104',
  loginEmail: process.env.E2E_LOGIN_EMAIL ?? 'chintan.e2e.billing@synthetic.test',
  storageStatePath: path.join(HERE, '..', '.auth', 'state.json'),
} as const;
