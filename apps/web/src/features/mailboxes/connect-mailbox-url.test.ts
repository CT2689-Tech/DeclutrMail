import { afterEach, describe, expect, it, vi } from 'vitest';

const openOAuthInShell = vi.hoisted(() => vi.fn());
vi.mock('@/lib/native/oauth-shell', () => ({ openOAuthInShell }));

import {
  connectMailboxStartUrl,
  reactivateMailboxStartUrl,
  startMailboxConnect,
  startMailboxReactivation,
} from './connect-mailbox-url';

describe('connectMailboxStartUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('builds the normal connect URL without a reconnect hint', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test/');

    expect(connectMailboxStartUrl()).toBe(
      'https://api.example.test/api/auth/google/connect-mailbox/start',
    );
  });

  it('encodes the opaque reconnect target', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');

    expect(connectMailboxStartUrl('mailbox/id with ? &')).toBe(
      'https://api.example.test/api/auth/google/connect-mailbox/start?reconnectMailboxId=mailbox%2Fid%20with%20%3F%20%26',
    );
  });

  it('hard-navigates to the targeted OAuth URL', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);

    startMailboxConnect('11111111-1111-4111-8111-111111111111');

    expect(assign).toHaveBeenCalledWith(
      'https://api.example.test/api/auth/google/connect-mailbox/start?reconnectMailboxId=11111111-1111-4111-8111-111111111111',
    );
    assign.mockRestore();
  });

  it('encodes a disconnected mailbox as a distinct reactivation target', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test/');

    expect(reactivateMailboxStartUrl('mailbox/id with ? &')).toBe(
      'https://api.example.test/api/auth/google/connect-mailbox/start?reactivateMailboxId=mailbox%2Fid%20with%20%3F%20%26',
    );
  });

  it('hard-navigates to the mailbox-bound reactivation URL', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);

    startMailboxReactivation('33333333-3333-4333-8333-333333333333');

    expect(assign).toHaveBeenCalledWith(
      'https://api.example.test/api/auth/google/connect-mailbox/start?reactivateMailboxId=33333333-3333-4333-8333-333333333333',
    );
    assign.mockRestore();
  });
});

it('preserves an exact Billing plan and origin through full Gmail reconnect', () => {
  const destination = '/billing?plan=pro&cycle=annual&promo=foundingPro&from=%2Fbrief';
  const url = new URL(
    connectMailboxStartUrl('11111111-1111-4111-8111-111111111111', destination),
    'http://localhost',
  );
  expect(url.searchParams.get('billingReturnTo')).toBe(destination);
  expect(connectMailboxStartUrl(undefined, 'https://evil.test/billing')).not.toContain(
    'billingReturnTo',
  );
  expect(connectMailboxStartUrl(undefined, '/settings')).not.toContain('billingReturnTo');
});

describe('inside the native app shell', () => {
  const API = 'https://api.example.test';
  const inShell = () =>
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 DeclutrMailShell');

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    openOAuthInShell.mockReset();
  });

  it('hands a connect to the shell and does not navigate the WebView to Google', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', API);
    inShell();
    openOAuthInShell.mockReturnValue(true);
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);

    startMailboxConnect('11111111-1111-4111-8111-111111111111');
    await vi.waitFor(() => expect(openOAuthInShell).toHaveBeenCalled());

    expect(openOAuthInShell).toHaveBeenCalledWith(
      `${API}/api/auth/google/connect-mailbox/start?reconnectMailboxId=11111111-1111-4111-8111-111111111111`,
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('hands a reactivation to the shell', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', API);
    inShell();
    openOAuthInShell.mockReturnValue(true);
    vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);

    startMailboxReactivation('33333333-3333-4333-8333-333333333333');
    await vi.waitFor(() => expect(openOAuthInShell).toHaveBeenCalled());

    expect(openOAuthInShell).toHaveBeenCalledWith(
      `${API}/api/auth/google/connect-mailbox/start?reactivateMailboxId=33333333-3333-4333-8333-333333333333`,
    );
  });

  it('falls back to a normal navigation for a URL the shell does not own', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', API);
    inShell();
    openOAuthInShell.mockReturnValue(false);
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);

    startMailboxConnect();
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());

    expect(assign).toHaveBeenCalledWith(`${API}/api/auth/google/connect-mailbox/start`);
  });

  it('never loads the shell code for an ordinary browser', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', API);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Safari');
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);

    startMailboxConnect();

    expect(assign).toHaveBeenCalledWith(`${API}/api/auth/google/connect-mailbox/start`);
    expect(openOAuthInShell).not.toHaveBeenCalled();
  });

  it('shows the failed result, not Google, when the shell code cannot load', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', API);
    inShell();
    vi.resetModules();
    vi.doMock('@/lib/native/oauth-shell', () => {
      throw new Error('Loading chunk failed');
    });
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const fresh = await import('./connect-mailbox-url');

    fresh.startMailboxConnect();
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());

    expect(assign).toHaveBeenCalledWith('/settings?connect_start_result=failed#mailboxes');
    vi.doUnmock('@/lib/native/oauth-shell');
  });
});
