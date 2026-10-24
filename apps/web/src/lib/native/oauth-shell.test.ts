import { PKCE_CHALLENGE_PATTERN, PKCE_VERIFIER_PATTERN } from '@declutrmail/shared/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClient from '../api/client';
import { ApiError } from '../api/client';
import {
  handleNativeReturn,
  installShellBridge,
  openOAuthInShell,
  startNativeConnect,
  startNativeSignIn,
} from './oauth-shell';
import { challengeOf, createPkcePair } from './pkce';
import { clearPending, readPending, savePending } from './pending-flow';

const browser = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));
const app = vi.hoisted(() => ({
  addListener: vi.fn(),
  getLaunchUrl: vi.fn(),
  remove: vi.fn(),
}));
const apiPost = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/browser', () => ({ Browser: browser }));
vi.mock('@capacitor/app', () => ({ App: app }));
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiPost,
}));

const API = 'https://api.declutrmail.test';
const CODE = 'A'.repeat(43);
const returnLink = (query: string) => `com.declutrmail.app://auth/return?${query}`;
const SESSION_LINK = returnLink(`code=${CODE}`);

let assign: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

function inShell(yes = true) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    yes ? 'Mozilla/5.0 (iPhone) DeclutrMailShell' : 'Mozilla/5.0 (iPhone) Safari',
  );
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', API);
  assign = vi.fn();
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    ...window.location,
    assign,
    href: 'https://app.declutrmail.test/sign-in',
    origin: 'https://app.declutrmail.test',
  } as unknown as Location);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  browser.open.mockResolvedValue(undefined);
  browser.close.mockResolvedValue(undefined);
  app.addListener.mockResolvedValue({ remove: app.remove });
  app.getLaunchUrl.mockResolvedValue(undefined);
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const mock of [browser.open, browser.close, app.addListener, app.getLaunchUrl, apiPost]) {
    mock.mockReset();
  }
});

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B vector', async () => {
    expect(await challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('makes a pattern-valid verifier whose challenge is its S256', async () => {
    const a = await createPkcePair();
    const b = await createPkcePair();
    expect(PKCE_VERIFIER_PATTERN.test(a.verifier)).toBe(true);
    expect(PKCE_CHALLENGE_PATTERN.test(a.challenge)).toBe(true);
    expect(a.challenge).toBe(await challengeOf(a.verifier));
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe('pending flow', () => {
  it('round-trips a sign-in and a connect flow', () => {
    savePending({ kind: 'signin', verifier: 'v'.repeat(43), startedAt: 1_000 });
    expect(readPending(2_000)).toEqual({
      kind: 'signin',
      verifier: 'v'.repeat(43),
      startedAt: 1_000,
    });
    savePending({ kind: 'connect', startedAt: 1_000 });
    expect(readPending(2_000)).toEqual({ kind: 'connect', startedAt: 1_000 });
  });

  it.each([
    ['stale', JSON.stringify({ kind: 'connect', startedAt: 1_000 }), 1_000 + 10 * 60 * 1000 + 1],
    ['from the future', JSON.stringify({ kind: 'connect', startedAt: 200_000 }), 1_000],
    ['a sign-in without a verifier', JSON.stringify({ kind: 'signin', startedAt: 1_000 }), 2_000],
    ['an unknown kind', JSON.stringify({ kind: 'other', startedAt: 1_000 }), 2_000],
    ['not json', '{nope', 2_000],
    ['null', 'null', 2_000],
  ])('reads nothing for %s', (_name, raw, now) => {
    localStorage.setItem('dm.native.pending', raw);
    expect(readPending(now)).toBeNull();
  });

  it('survives blocked storage without throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => savePending({ kind: 'connect', startedAt: 1 })).not.toThrow();
    expect(readPending()).toBeNull();
    expect(() => clearPending()).not.toThrow();
  });
});

describe('openOAuthInShell', () => {
  it('does nothing outside the native shell', () => {
    inShell(false);
    expect(openOAuthInShell(`${API}/api/auth/google/start`)).toBe(false);
    expect(browser.open).not.toHaveBeenCalled();
    expect(readPending()).toBeNull();
  });

  it('opens sign-in in the system browser with a challenge it can later answer', async () => {
    inShell();
    expect(
      openOAuthInShell(`${API}/api/auth/google/start?intent=sign-in&returnTo=%2Fsettings&ref=x`),
    ).toBe(true);
    await vi.waitFor(() => expect(browser.open).toHaveBeenCalled());

    const opened = new URL(browser.open.mock.calls[0]![0].url);
    expect(opened.origin + opened.pathname).toBe(`${API}/api/auth/google/native/start`);
    expect(opened.searchParams.get('returnTo')).toBe('/settings');
    expect(opened.searchParams.get('intent')).toBe('sign-in');
    expect(opened.searchParams.has('ref')).toBe(false);
    const pending = readPending();
    expect(pending?.kind).toBe('signin');
    expect(await challengeOf((pending as { verifier: string }).verifier)).toBe(
      opened.searchParams.get('challenge'),
    );
    // The verifier itself never rides the URL.
    expect(opened.href).not.toContain((pending as { verifier: string }).verifier);
  });

  it.each([
    ['another origin', 'https://evil.test/api/auth/google/start'],
    ['another path', `${API}/api/auth/google/callback`],
    ['a look-alike path', `${API}/api/auth/google/start/extra`],
    ['not a url', 'http://'],
  ])('leaves %s alone', (_name, href) => {
    inShell();
    expect(openOAuthInShell(href)).toBe(false);
    expect(browser.open).not.toHaveBeenCalled();
  });

  it('asks for a ticket for a connect and opens the URL the API returns', async () => {
    inShell();
    apiPost.mockResolvedValue({ data: { url: `${API}/api/auth/google/native/open?ticket=t` } });
    const target = '11111111-1111-4111-8111-111111111111';

    expect(
      openOAuthInShell(`${API}/api/auth/google/connect-mailbox/start?reconnectMailboxId=${target}`),
    ).toBe(true);
    await vi.waitFor(() => expect(browser.open).toHaveBeenCalled());

    expect(apiPost).toHaveBeenCalledWith('/api/auth/google/native/connect-ticket', undefined, {
      query: { reconnectMailboxId: target },
    });
    expect(browser.open).toHaveBeenCalledWith({
      url: `${API}/api/auth/google/native/open?ticket=t`,
    });
    expect(readPending()?.kind).toBe('connect');
  });
});

describe('a flow that cannot start returns the person to a result the web already shows', () => {
  it('sign-in: the browser will not open', async () => {
    browser.open.mockRejectedValue(new Error('no browser'));
    await startNativeSignIn({});
    expect(assign).toHaveBeenCalledWith('/sign-in?auth_result=failed');
    expect(readPending()).toBeNull();
  });

  it.each([
    [new ApiError(402, { error: { details: { reason: 'pass' } } }, 'x'), 'pass_second_account'],
    [new ApiError(402, { error: {} }, 'x'), 'inbox_limit'],
    [new ApiError(400, null, 'x'), 'target_invalid'],
    [new ApiError(429, null, 'x'), 'rate_limited'],
    [new ApiError(500, null, 'x'), 'failed'],
    [new Error('offline'), 'failed'],
  ])('connect: %s', async (error, result) => {
    apiPost.mockRejectedValue(error);
    await startNativeConnect({});
    expect(assign).toHaveBeenCalledWith(`/settings?connect_start_result=${result}#mailboxes`);
    expect(readPending()).toBeNull();
  });

  it('connect during billing resumes the scan on onboarding', async () => {
    apiPost.mockRejectedValue(new ApiError(402, null, 'x'));
    await startNativeConnect({ billingReturnTo: '/billing?plan=pro&cycle=annual' });
    const [target] = assign.mock.calls[0]!;
    expect(target).toBe(
      `/onboarding?${new URLSearchParams({ resumeScan: '1', returnTo: '/billing?plan=pro&cycle=annual', connect_start_result: 'inbox_limit' })}`,
    );
  });

  it('connect: a dead session is left to the API client, which already redirected', async () => {
    apiPost.mockRejectedValue(new ApiError(401, null, 'x'));
    await startNativeConnect({});
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('handleNativeReturn', () => {
  const answer = (ok: boolean, body: unknown) =>
    fetchMock.mockResolvedValue({ ok, json: async () => body });

  it('ignores a link that is not ours', async () => {
    savePending({ kind: 'connect', startedAt: Date.now() });
    await handleNativeReturn('https://evil.test/auth/return?code=x');
    await handleNativeReturn(returnLink('to=https://evil.test'));
    expect(assign).not.toHaveBeenCalled();
    expect(readPending()).not.toBeNull();
  });

  it('ignores a valid link when this app started no flow', async () => {
    await handleNativeReturn(SESSION_LINK);
    await handleNativeReturn(returnLink('to=%2Fsettings'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('ignores a link once the pending flow is stale', async () => {
    savePending({ kind: 'connect', startedAt: Date.now() - 11 * 60 * 1000 });
    await handleNativeReturn(returnLink('to=%2Fsettings'));
    expect(assign).not.toHaveBeenCalled();
  });

  it('opens the path a navigation return names, once', async () => {
    savePending({ kind: 'connect', startedAt: Date.now() });
    await handleNativeReturn(returnLink('to=%2Fonboarding%3Fmailbox%3Dm1'));
    expect(assign).toHaveBeenCalledWith('/onboarding?mailbox=m1');
    expect(readPending()).toBeNull();
    await handleNativeReturn(returnLink('to=%2Fonboarding%3Fmailbox%3Dm1'));
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('redeems a sign-in code with the verifier it holds and lands where the server says', async () => {
    const verifier = 'v'.repeat(43);
    savePending({ kind: 'signin', verifier, startedAt: Date.now() });
    answer(true, { data: { returnTo: '/onboarding' } });

    await handleNativeReturn(SESSION_LINK);

    expect(fetchMock).toHaveBeenCalledWith(`${API}/api/auth/native/exchange`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: CODE, verifier }),
    });
    expect(assign).toHaveBeenCalledWith('/onboarding');
    expect(readPending()).toBeNull();
  });

  it.each([
    ['a refusal', () => fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })],
    ['a network failure', () => fetchMock.mockRejectedValue(new Error('offline'))],
    ['an off-site destination', () => answer(true, { data: { returnTo: 'https://evil.test' } })],
    ['no destination', () => answer(true, { data: {} })],
  ])('a sign-in code that meets %s ends on the failed sign-in result', async (_name, arrange) => {
    savePending({ kind: 'signin', verifier: 'v'.repeat(43), startedAt: Date.now() });
    arrange();
    await handleNativeReturn(SESSION_LINK);
    expect(assign).toHaveBeenCalledWith('/sign-in?auth_result=failed');
    expect(readPending()).toBeNull();
  });

  it('does not redeem a code for a connect flow that holds no verifier', async () => {
    savePending({ kind: 'connect', startedAt: Date.now() });
    await handleNativeReturn(SESSION_LINK);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(readPending()).toBeNull();
  });

  it('still handles the return when the browser sheet cannot be closed', async () => {
    browser.close.mockRejectedValue(new Error('not supported'));
    savePending({ kind: 'connect', startedAt: Date.now() });
    await handleNativeReturn(returnLink('to=%2Fhome'));
    expect(assign).toHaveBeenCalledWith('/home');
  });
});

describe('installShellBridge', () => {
  const clickOn = (html: string, init: MouseEventInit = {}) => {
    document.body.innerHTML = html;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    document.querySelector('a')!.dispatchEvent(event);
    return event;
  };

  it('diverts a click on an OAuth link and leaves other links alone', async () => {
    inShell();
    const remove = await installShellBridge();

    const oauth = clickOn(`<a href="${API}/api/auth/google/start?intent=sign-in">Sign in</a>`);
    expect(oauth.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(browser.open).toHaveBeenCalled());

    expect(clickOn('<a href="/pricing">Pricing</a>').defaultPrevented).toBe(false);
    expect(
      clickOn(`<a href="${API}/api/auth/google/start">x</a>`, { metaKey: true }).defaultPrevented,
    ).toBe(false);
    remove();
  });

  it('diverts a click on an element inside the link', async () => {
    inShell();
    const remove = await installShellBridge();
    document.body.innerHTML = `<a href="${API}/api/auth/google/start"><span>Get started</span></a>`;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    document.querySelector('span')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    remove();
  });

  it('stops diverting after teardown', async () => {
    inShell();
    const remove = await installShellBridge();
    remove();
    expect(clickOn(`<a href="${API}/api/auth/google/start">x</a>`).defaultPrevented).toBe(false);
    expect(app.remove).toHaveBeenCalled();
  });

  it('handles the app-open event and the launch link', async () => {
    inShell();
    savePending({ kind: 'connect', startedAt: Date.now() });
    app.getLaunchUrl.mockResolvedValue({ url: returnLink('to=%2Fhome') });
    await installShellBridge();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/home'));

    savePending({ kind: 'connect', startedAt: Date.now() });
    const onOpen = app.addListener.mock.calls[0]![1] as (event: { url: string }) => void;
    onOpen({ url: returnLink('to=%2Fsettings') });
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/settings'));
  });
});
