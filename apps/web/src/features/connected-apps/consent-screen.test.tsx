import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConnectorConsent } from '@declutrmail/shared/contracts';

import { installFetchStub, jsonOk, jsonServerError } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { ConsentCard, ConsentScreen, isApiResumeUrl } from './consent-screen';
import { SCOPE_LABEL } from './scope-copy';

const REQUEST = 'CUygbhMUbHwTzNhgVgnRZC1EjwMfy2c_9vKePrg8rq9';
const BASE = `/api/oauth/interactions/${REQUEST}`;
const RESUME = `http://localhost:3000/oauth/authorize/${REQUEST}`;

const h = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(h.search),
}));

const CONSENT: ConnectorConsent = {
  appName: 'Claude',
  redirectHost: 'claude.ai',
  scopes: ['cleanup', 'read'],
  mailboxes: ['ada@example.com', 'ada.work@example.com'],
};

const jsonError = (status: number, code: string) =>
  new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function renderScreen(handlers: Parameters<typeof installFetchStub>[0]) {
  installFetchStub(handlers);
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <ConsentScreen />
    </QueryWrapper>,
  );
}

const details = (consent: unknown = CONSENT) => ({
  method: 'GET' as const,
  path: `${BASE}/details`,
  respond: () => jsonOk({ data: consent }),
});

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.search = `request=${REQUEST}`;
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, origin: 'http://localhost:3000', assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConsentCard', () => {
  const ready = (overrides: Partial<ConnectorConsent> = {}) =>
    render(
      <ConsentCard
        state={{
          kind: 'ready',
          consent: { ...CONSENT, ...overrides },
          deciding: null,
          decisionError: null,
          onApprove: () => {},
          onDeny: () => {},
        }}
      />,
    );

  it('shows the app, where the person returns, what it may do and which accounts', () => {
    ready();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Connect Claude to DeclutrMail?',
    );
    // The redirect host is the part an impostor cannot choose.
    expect(screen.getByText('claude.ai')).toBeTruthy();
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual([
      SCOPE_LABEL.read,
      SCOPE_LABEL.cleanup,
      'ada@example.com',
      'ada.work@example.com',
    ]);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
  });

  it('lists only the scopes that were requested', () => {
    ready({ scopes: ['read'] });
    expect(screen.queryByText(SCOPE_LABEL.cleanup)).toBeNull();
    expect(screen.getByText(SCOPE_LABEL.read)).toBeTruthy();
  });

  it('does not invent a name for an app that registered without one', () => {
    ready({ appName: null });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Connect Unnamed app to DeclutrMail?',
    );
  });

  it('says so when no Gmail account is connected', () => {
    ready({ mailboxes: [] });
    expect(screen.getByText('No Gmail account is connected yet.')).toBeTruthy();
  });

  it('renders an app name as text, never as markup', () => {
    const { container } = ready({ appName: '<img src=x onerror=alert(1)>' });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('locks both buttons while a decision is in flight', () => {
    render(
      <ConsentCard
        state={{
          kind: 'ready',
          consent: CONSENT,
          deciding: 'approve',
          decisionError: null,
          onApprove: () => {},
          onDeny: () => {},
        }}
      />,
    );
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(buttons.map((button) => button.disabled)).toEqual([true, true]);
    expect(buttons[0]!.textContent).toBe('Approving…');
  });

  it('an expired request says what happened and what to do, with no buttons', () => {
    render(<ConsentCard state={{ kind: 'gone' }} />);
    expect(screen.getByRole('alert').textContent).toBe(
      'This connection request has expiredGo back to your app and connect again.',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ConsentScreen', () => {
  it('loads the request named in the URL and shows it', async () => {
    renderScreen([details()]);
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByText('claude.ai')).toBeTruthy();
  });

  it.each([
    ['no request id', ''],
    ['a malformed request id', 'request=../../etc'],
    ['a request id that is too short', 'request=abc'],
  ])('%s is an expired request and reads nothing', async (_label, search) => {
    h.search = search;
    let calls = 0;
    renderScreen([
      {
        method: 'GET',
        path: /.*/,
        respond: () => {
          calls += 1;
          return jsonOk({ data: CONSENT });
        },
      },
    ]);
    expect(await screen.findByText('This connection request has expired')).toBeTruthy();
    expect(calls).toBe(0);
  });

  it.each([
    ['expired (410)', 410, 'CONNECT_REQUEST_EXPIRED'],
    ['connector switched off (404)', 404, 'NOT_FOUND'],
  ])('%s shows the expired state and is not retried', async (_label, status, code) => {
    let calls = 0;
    renderScreen([
      {
        method: 'GET',
        path: `${BASE}/details`,
        respond: () => {
          calls += 1;
          return jsonError(status, code);
        },
      },
    ]);
    expect(await screen.findByText('This connection request has expired')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(1);
  });

  it('a server error offers Try again and recovers', async () => {
    let healthy = false;
    renderScreen([
      {
        method: 'GET',
        path: `${BASE}/details`,
        respond: () => (healthy ? jsonOk({ data: CONSENT }) : jsonServerError()),
      },
    ]);
    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 5_000 });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    healthy = true;
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('refuses a body it cannot read rather than showing a half-filled request', async () => {
    renderScreen([
      details({ appName: 'Claude', redirectHost: 'claude.ai', scopes: ['everything'] }),
    ]);
    expect(
      await screen.findByRole('button', { name: 'Try again' }, { timeout: 5_000 }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it.each([
    ['Approve', 'approve'],
    ['Deny', 'deny'],
  ])('%s records the decision and sends the browser to the API to resume', async (label, path) => {
    const posted: string[] = [];
    renderScreen([
      details(),
      {
        method: 'POST',
        path: new RegExp(`^${BASE}/(approve|deny)$`),
        respond: (_req, url) => {
          posted.push(url.pathname);
          return jsonOk({ data: { redirectTo: RESUME } });
        },
      },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: label }));
    await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith(RESUME));
    expect(posted).toEqual([`${BASE}/${path}`]);
    expect((await screen.findByRole('status')).textContent).toBe('Returning to claude.ai…');
  });

  it('never follows a redirect that is not the API resume URL', async () => {
    renderScreen([
      details(),
      {
        method: 'POST',
        path: `${BASE}/approve`,
        respond: () => jsonOk({ data: { redirectTo: 'https://attacker.example/steal' } }),
      },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('a request that expired between load and Approve becomes the expired state', async () => {
    renderScreen([
      details(),
      {
        method: 'POST',
        path: `${BASE}/approve`,
        respond: () => jsonError(410, 'CONNECT_REQUEST_EXPIRED'),
      },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('This connection request has expired')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('an account with deletion scheduled is told why, and can still Deny', async () => {
    renderScreen([
      details(),
      {
        method: 'POST',
        path: `${BASE}/approve`,
        respond: () => jsonError(409, 'CONNECT_DELETION_PENDING'),
      },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Account deletion is scheduled. Cancel it in Settings to connect an app.',
    );
    expect((screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('a failed decision says to try again and leaves both choices open', async () => {
    renderScreen([
      details(),
      { method: 'POST', path: `${BASE}/approve`, respond: () => jsonServerError() },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That did not go through. Try again.',
    );
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('isApiResumeUrl', () => {
  const api = 'https://api.declutrmail.com';
  const page = 'https://app.declutrmail.com';

  it('accepts only the API resume path for a well-formed request id', () => {
    expect(isApiResumeUrl(`${api}/oauth/authorize/${REQUEST}`, api, page)).toBe(true);
    // Same-origin deployments leave NEXT_PUBLIC_API_URL empty.
    expect(isApiResumeUrl(`${page}/oauth/authorize/${REQUEST}`, '', page)).toBe(true);
  });

  it.each([
    ['another origin', `https://attacker.example/oauth/authorize/${REQUEST}`],
    ['the web origin when the API lives elsewhere', `${page}/oauth/authorize/${REQUEST}`],
    [
      'a look-alike host',
      `https://api.declutrmail.com.attacker.example/oauth/authorize/${REQUEST}`,
    ],
    [
      'userinfo before the host',
      `https://api.declutrmail.com@attacker.example/oauth/authorize/${REQUEST}`,
    ],
    ['another path', `${api}/api/auth/logout`],
    ['a path traversal', `${api}/oauth/authorize/../../api/auth/logout`],
    ['a query string', `${api}/oauth/authorize/${REQUEST}?next=https://attacker.example`],
    ['a fragment', `${api}/oauth/authorize/${REQUEST}#x`],
    ['javascript:', 'javascript:alert(1)'],
    ['a relative path', `/oauth/authorize/${REQUEST}`],
    ['plain http to the API host', `http://api.declutrmail.com/oauth/authorize/${REQUEST}`],
  ])('refuses %s', (_label, target) => {
    expect(isApiResumeUrl(target, api, page)).toBe(false);
  });
});
