import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, type Page } from '@playwright/test';

import { E2E_ENV } from './env';

/**
 * A stand-in for an assistant app in the MCP connector journeys
 * (ADR-0048): it registers itself, listens on a loopback port for the
 * OAuth callback, exchanges the code, and calls tools with the token.
 * The real API and the real pages do everything else.
 */

const API = E2E_ENV.apiUrl;

export interface TestApp {
  clientId: string;
  redirectUri: string;
  /** The most recent callback the app received. */
  callback: () => URL;
  close: () => Promise<void>;
}

export async function startApp(name: string): Promise<TestApp> {
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

export function authorizeUrl(
  app: TestApp,
  challenge: string,
  state: string,
  scope = 'read cleanup',
): string {
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

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** The dev test login stands in for Google; it sets the real session cookies. */
export async function signIn(page: Page, email: string = E2E_ENV.loginEmail): Promise<void> {
  const response = await page.request.get(
    `${API}/api/auth/dev/login?email=${encodeURIComponent(email)}`,
    { maxRedirects: 0 },
  );
  expect(response.status(), `dev login for ${email}`).toBe(302);
}

/** Exchange the code the app's callback received for tokens. */
export async function exchangeCode(
  app: TestApp,
  verifier: string,
): Promise<{ access_token: string; scope: string }> {
  const exchange = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: app.callback().searchParams.get('code') ?? '',
      code_verifier: verifier,
      client_id: app.clientId,
      redirect_uri: app.redirectUri,
    }),
  });
  expect(exchange.status).toBe(200);
  return (await exchange.json()) as { access_token: string; scope: string };
}

/**
 * Connect `app` for the person signed in on `page`: authorize → the real
 * consent page → Approve → code → token.
 */
export async function connectApp(page: Page, app: TestApp, state: string): Promise<string> {
  const proof = pkce();
  await page.goto(authorizeUrl(app, proof.challenge, state));
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.waitForURL(`${app.redirectUri}?**`);
  expect(app.callback().searchParams.get('state')).toBe(state);
  return (await exchangeCode(app, proof.verifier)).access_token;
}

export interface ToolAnswer {
  status: number;
  isError: boolean;
  /** `structuredContent` of a success. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper; every use is an assertion
  data: any;
  /** `{ code, message, … }` of a tool error. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper; every use is an assertion
  error: any;
  /** The text block exactly as the assistant receives it. */
  text: string;
}

/** One raw MCP request with the app's token. */
export function mcpRequest(token: string, method: string, params: unknown = {}): Promise<Response> {
  return fetch(`${API}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

/** Call one connector tool the way an assistant does. */
export async function callTool(
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolAnswer> {
  const response = await mcpRequest(token, 'tools/call', { name, arguments: args });
  const raw = await response.text();
  // The SDK answers a pre-2026 client over an event stream.
  const framed = raw
    .split('\n')
    .find((line) => line.startsWith('data:'))
    ?.slice('data:'.length);
  let body: { result?: Record<string, unknown>; error?: unknown } = {};
  try {
    body = JSON.parse(framed ?? raw) as typeof body;
  } catch {
    // Left empty: the caller's assertions report the raw text.
  }
  const result = body.result as
    | { isError?: boolean; structuredContent?: unknown; content?: Array<{ text?: string }> }
    | undefined;
  const text = result?.content?.[0]?.text ?? raw;
  if (!result || result.isError) {
    let error: unknown = body.error;
    try {
      error = (JSON.parse(text) as { error?: unknown }).error ?? error;
    } catch {
      // Not JSON: keep the protocol-level error, if any.
    }
    return { status: response.status, isError: true, data: undefined, error, text };
  }
  return {
    status: response.status,
    isError: false,
    data: result.structuredContent,
    error: undefined,
    text,
  };
}
