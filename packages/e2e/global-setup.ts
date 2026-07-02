import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { request, type FullConfig } from '@playwright/test';

import { dbConnect } from './helpers/db';
import { E2E_ENV } from './helpers/env';
import { applyBillingSeed } from './helpers/seed-billing';

/**
 * Global setup — seed the Gmail-free synthetic workspace, then
 * authenticate once via the D206 dev test-login and persist the
 * session cookies as `storageState` for every spec.
 *
 * `GET /api/auth/dev/login?email=…` issues the three real session
 * cookies (`dm_access` / `dm_refresh` / `dm_csrf`) on the localhost
 * domain — cookies are port-agnostic, so the same jar authenticates
 * both the web origin (:3104) and direct api calls (:4104).
 *
 * `maxRedirects: 0` — the route 302s to `WEB_URL` (default :3000),
 * which may not be running in this harness; we only need the
 * Set-Cookie side effect.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  // Gmail-free billing seed (D183) — BEFORE any login: the dev-login
  // never creates users, so the synthetic billing user must already
  // exist (and a Gmail-free environment may set E2E_LOGIN_EMAIL to it,
  // needing no founder account at all). Idempotent; fixed synthetic ids
  // only — the founder's rows are never touched.
  const sql = dbConnect();
  try {
    await applyBillingSeed(sql);
  } finally {
    await sql.end();
  }

  const ctx = await request.newContext({ baseURL: E2E_ENV.apiUrl });
  const res = await ctx.get(`/api/auth/dev/login?email=${encodeURIComponent(E2E_ENV.loginEmail)}`, {
    maxRedirects: 0,
  });
  if (res.status() !== 302) {
    throw new Error(
      `Dev login failed (HTTP ${res.status()}) at ${E2E_ENV.apiUrl}/api/auth/dev/login — ` +
        `is the api up with DEV_AUTH_ENABLED=true and DEV_AUTH_EMAIL_PREFIX set, ` +
        `and does the user ${E2E_ENV.loginEmail} exist?`,
    );
  }
  const state = await ctx.storageState();
  const hasSession = state.cookies.some((c) => c.name === 'dm_access');
  if (!hasSession) {
    throw new Error('Dev login returned 302 but set no dm_access cookie — check the api logs.');
  }
  mkdirSync(path.dirname(E2E_ENV.storageStatePath), { recursive: true });
  await ctx.storageState({ path: E2E_ENV.storageStatePath });
  await ctx.dispose();

  // Warm the Next dev server: the first request to each route triggers
  // an on-demand compile that can exceed a spec's navigation timeout
  // (cold /senders has taken minutes on a loaded machine). Compile is
  // auth-agnostic, so plain GETs are enough. Best-effort — a prod-built
  // web server answers instantly and a failure surfaces in the spec.
  const warm = await request.newContext({ baseURL: E2E_ENV.webUrl });
  for (const route of ['/triage', '/senders', '/senders/00000000-0000-0000-0000-000000000000']) {
    try {
      await warm.get(route, { timeout: 600_000 });
    } catch {
      // Non-fatal: specs assert real navigations with their own timeouts.
    }
  }
  await warm.dispose();
}
