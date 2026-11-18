import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test, type Page } from '@playwright/test';

import { dbConnect } from '../helpers/db';
import { E2E_ENV } from '../helpers/env';
import { BILLING_SEED } from '../helpers/seed-billing';

/**
 * Connecting an app through the MCP connector's OAuth flow (ADR-0048
 * rule 4, docs/spec/mcp-connector.md §4 + §8) — the real API, the real
 * consent page and a real browser. The "app" is this test: it registers
 * itself, listens on a loopback port for the callback, and exchanges the
 * code. No Google, no Gmail, no worker.
 *
 * Journeys:
 *   1. Signed out at authorize → sign-in, carrying the way back →
 *      consent → Approve → the app holds a working token → Settings
 *      lists it → Disconnect → the token is dead.
 *   2. Deny → the app is told `access_denied` and nothing is connected.
 */

const API = E2E_ENV.apiUrl;

interface TestApp {
  clientId: string;
  redirectUri: string;
  /** The most recent callback the app received. */
  callback: () => URL;
  close: () => Promise<void>;
}

async function startApp(name: string): Promise<TestApp> {
  let last: URL | null = null;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    // The browser also asks for /favicon.ico; only the callback counts.
    if (url.pathname === '/callback') last = url;
    res.setHeader('content-type', 'text/html');
    res.end('<main><h1>App callback</h1></main>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  // Registered with another port on purpose: a loopback app picks its
  // port when the request is made (RFC 8252 §7.3).
  const registration = await fetch(`${API}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: ['http://127.0.0.1:1/callback'],
      token_endpoint_auth_method: 'none',
    }),
  });
  expect(registration.status).toBe(201);
  const { client_id: clientId } = (await registration.json()) as { client_id: string };
  return {
    clientId,
    redirectUri: `http://127.0.0.1:${port}/callback`,
    callback: () => {
      if (!last) throw new Error('The app received no callback.');
      return last;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function authorizeUrl(app: TestApp, challenge: string, state: string, scope = 'read cleanup') {
  return `${API}/oauth/authorize?${new URLSearchParams({
    client_id: app.clientId,
    response_type: 'code',
    redirect_uri: app.redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope,
  })}`;
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function signIn(page: Page) {
  // The dev test login stands in for Google; it sets the real session cookies.
  await page.request.get(
    `${API}/api/auth/dev/login?email=${encodeURIComponent(E2E_ENV.loginEmail)}`,
    {
      maxRedirects: 0,
    },
  );
}

const callMcp = (token: string) =>
  fetch(`${API}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });

async function removeConnections() {
  const sql = dbConnect();
  try {
    await sql`DELETE FROM oauth_grants WHERE user_id = ${BILLING_SEED.userId}`;
  } finally {
    await sql.end();
  }
}

// Every journey starts signed out: that is the state an app sends a person in.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeAll(async () => {
  const metadata = await fetch(`${API}/.well-known/oauth-authorization-server`);
  // The isolated stack switches the connector on; a 404 here is a broken stack.
  expect(metadata.status, 'MCP_ENABLED must be on in the isolated stack').toBe(200);
  await removeConnections();
});

test.afterAll(removeConnections);

test('a signed-out person signs in, approves, and can disconnect the app in Settings', async ({
  page,
}) => {
  const app = await startApp('Journey Assistant');
  const proof = pkce();
  try {
    // 1. Not signed in at authorize → sign-in, with the way back.
    await page.goto(authorizeUrl(app, proof.challenge, 'approve-journey'));
    await page.waitForURL(/\/sign-in\?/);
    const signInUrl = new URL(page.url());
    const returnTo = signInUrl.searchParams.get('returnTo');
    expect(returnTo).toMatch(/^\/connect\/authorize\?request=[A-Za-z0-9_-]{16,64}$/);
    // The Google button carries the same way back through OAuth.
    const start = await page
      .getByRole('link', { name: /google/i })
      .first()
      .getAttribute('href');
    expect(decodeURIComponent(start ?? '')).toContain(returnTo!);

    // 2. Signed in → back to the same request → consent.
    await signIn(page);
    await page.goto(`${E2E_ENV.webUrl}${returnTo}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Connect Journey Assistant to DeclutrMail?',
    );
    await expect(page.getByText(new URL(app.redirectUri).host)).toBeVisible();
    await expect(page.getByRole('listitem')).toContainText([
      'See your senders and subject lines',
      'with your confirmation',
    ]);

    // 3. Approve → the app receives a code and exchanges it.
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.waitForURL(`${app.redirectUri}?**`);
    const callback = app.callback();
    expect(callback.searchParams.get('state')).toBe('approve-journey');
    expect(callback.searchParams.get('iss')).toBe(API);
    const exchange = await fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: callback.searchParams.get('code') ?? '',
        code_verifier: proof.verifier,
        client_id: app.clientId,
        redirect_uri: app.redirectUri,
      }),
    });
    expect(exchange.status).toBe(200);
    const tokens = (await exchange.json()) as { access_token: string; scope: string };
    expect(tokens.scope).toBe('read cleanup');
    expect((await callMcp(tokens.access_token)).status).toBe(200);

    // 4. Settings → Connected apps → Disconnect.
    await page.goto('/settings');
    const group = page.getByTestId('settings-connected-apps');
    await expect(group).toContainText('Journey Assistant');
    await group.getByRole('button', { name: 'Disconnect Journey Assistant' }).click();
    await expect(group).toContainText('No apps connected');
    await expect(page.getByText('Disconnected Journey Assistant.')).toBeVisible();

    // 5. The token the app still holds is refused, with the way to reconnect.
    const refused = await callMcp(tokens.access_token);
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect(refused.headers.get('www-authenticate')).toContain(
      `resource_metadata="${API}/.well-known/oauth-protected-resource/mcp"`,
    );
  } finally {
    await app.close();
  }
});

test('Deny tells the app access_denied and connects nothing', async ({ page }) => {
  const app = await startApp('Declined Assistant');
  try {
    await signIn(page);
    await page.goto(authorizeUrl(app, pkce().challenge, 'deny-journey', 'read'));
    // Only the requested scope is listed.
    await expect(page.getByText('See your senders and subject lines')).toBeVisible();
    await expect(page.getByText('with your confirmation')).toHaveCount(0);

    await page.getByRole('button', { name: 'Deny' }).click();
    await page.waitForURL(`${app.redirectUri}?**`);
    const callback = app.callback();
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('state')).toBe('deny-journey');
    expect(callback.searchParams.get('code')).toBeNull();

    await page.goto('/settings');
    await expect(page.getByTestId('settings-connected-apps')).toContainText('No apps connected');
  } finally {
    await app.close();
  }
});

test('a request this browser did not start reads as no longer available, at phone width too', async ({
  page,
}) => {
  await signIn(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`/connect/authorize?request=${'x'.repeat(43)}`);
  // Scoped to the page's own content: Next adds an alert-role route announcer.
  const main = page.getByRole('main');
  await expect(main.getByRole('alert')).toContainText(
    'This connection request is no longer available',
  );
  await expect(main.getByRole('button')).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
