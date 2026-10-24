// Google sign-in and Gmail connect inside the native app shell (ADR-0049).
//
// Google refuses OAuth in an embedded WebView, so inside the shell every
// navigation to the API's OAuth start URLs is diverted to the system browser.
// The browser runs the existing flow and comes back through a custom-scheme
// link: a one-time code to redeem for this app's own session (sign-in), or a
// path to open (everything else). Outside the shell none of this runs.

import {
  isNativeSafePath,
  parseBillingReturnTo,
  parseNativeReturnUrl,
  type NativeConnectTicketRequest,
  type NativeConnectTicketResponse,
} from '@declutrmail/shared/contracts';

import { ApiError, apiPost } from '../api/client';
import { createPkcePair } from './pkce';
import { clearPending, readPending, savePending } from './pending-flow';
import { isNativeShell } from './shell';

const GOOGLE_START_PATH = '/api/auth/google/start';
const CONNECT_START_PATH = '/api/auth/google/connect-mailbox/start';

/** The closed results the web app already shows for these failures. */
const SIGN_IN_FAILED = '/sign-in?auth_result=failed';

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
}

function apiOrigin(): string {
  return new URL(apiBase() || window.location.origin).origin;
}

async function openInSystemBrowser(url: string): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url });
}

/** Begin Google sign-in in the system browser, bound to a fresh PKCE verifier. */
export async function startNativeSignIn(input: {
  returnTo?: string | null;
  intent?: string | null;
}): Promise<void> {
  try {
    const { verifier, challenge } = await createPkcePair();
    savePending({ kind: 'signin', verifier, startedAt: Date.now() });
    const query = new URLSearchParams({
      challenge,
      ...(input.returnTo ? { returnTo: input.returnTo } : {}),
      ...(input.intent === 'sign-in' ? { intent: 'sign-in' } : {}),
    });
    await openInSystemBrowser(`${apiBase()}/api/auth/google/native/start?${query}`);
  } catch {
    clearPending();
    window.location.assign(SIGN_IN_FAILED);
  }
}

/**
 * The closed result for a refused connect ticket. Mirrors
 * `connectMailboxStartResult` in the API's connect-mailbox-start filter, so a
 * refusal reads the same whether it came from the browser route or this one.
 */
function connectFailureResult(error: unknown): string {
  if (!(error instanceof ApiError)) return 'failed';
  switch (error.status) {
    case 400:
      return 'target_invalid';
    case 402: {
      const reason = (error.body as { error?: { details?: { reason?: unknown } } } | null)?.error
        ?.details?.reason;
      return reason === 'pass' ? 'pass_second_account' : 'inbox_limit';
    }
    case 429:
      return 'rate_limited';
    default:
      return 'failed';
  }
}

/** Add or recover a Gmail account: the app asks for a ticket, the browser redeems it. */
export async function startNativeConnect(targets: NativeConnectTicketRequest): Promise<void> {
  try {
    const { data } = await apiPost<NativeConnectTicketResponse>(
      '/api/auth/google/native/connect-ticket',
      undefined,
      { query: targets },
    );
    savePending({ kind: 'connect', startedAt: Date.now() });
    await openInSystemBrowser(data.url);
  } catch (error) {
    clearPending();
    // A dead session already sent the page to sign in (the API client's
    // terminal-401 path); a second navigation here would race it.
    if (error instanceof ApiError && error.status === 401) return;
    const destination = parseBillingReturnTo(targets.billingReturnTo);
    const query = new URLSearchParams({
      ...(destination ? { resumeScan: '1', returnTo: destination } : {}),
      connect_start_result: connectFailureResult(error),
    });
    window.location.assign(destination ? `/onboarding?${query}` : `/settings?${query}#mailboxes`);
  }
}

/**
 * Divert an OAuth start URL to the system browser. Returns true when the shell
 * took it, so a caller falls back to ordinary navigation on false, which is
 * every case outside the shell.
 */
export function openOAuthInShell(href: string): boolean {
  if (!isNativeShell()) return false;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== apiOrigin()) return false;

  if (url.pathname === GOOGLE_START_PATH) {
    void startNativeSignIn({
      returnTo: url.searchParams.get('returnTo'),
      intent: url.searchParams.get('intent'),
    });
    return true;
  }
  if (url.pathname === CONNECT_START_PATH) {
    const reconnectMailboxId = url.searchParams.get('reconnectMailboxId');
    const reactivateMailboxId = url.searchParams.get('reactivateMailboxId');
    const billingReturnTo = url.searchParams.get('billingReturnTo');
    void startNativeConnect({
      ...(reconnectMailboxId ? { reconnectMailboxId } : {}),
      ...(reactivateMailboxId ? { reactivateMailboxId } : {}),
      ...(billingReturnTo ? { billingReturnTo } : {}),
    });
    return true;
  }
  return false;
}

/** Redeem the code with the verifier this app generated. Null for any refusal. */
async function exchangeCode(code: string, verifier: string): Promise<string | null> {
  const res = await fetch(`${apiBase()}/api/auth/native/exchange`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, verifier }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { returnTo?: unknown } };
  const returnTo = body.data?.returnTo;
  return isNativeSafePath(returnTo) ? returnTo : null;
}

/**
 * The system browser finished and opened the app. Honored only while a flow
 * this app started is pending: the link scheme can be fired by any other app
 * or web page, so a stray link must not sign anyone in or move them. A sign-in
 * return redeems its code; every other return is a path to open.
 */
export async function handleNativeReturn(link: string): Promise<void> {
  const returned = parseNativeReturnUrl(link);
  if (!returned) return;
  const pending = readPending();
  if (!pending) return;

  await import('@capacitor/browser')
    .then(({ Browser }) => Browser.close())
    // Closing is cosmetic: Android has no programmatic close, and the sheet may
    // already be gone. The return itself is handled either way.
    .catch(() => undefined);

  if (returned.kind === 'navigate') {
    clearPending();
    window.location.assign(returned.to);
    return;
  }
  // A code is only meaningful to the sign-in that holds the matching verifier.
  if (pending.kind !== 'signin') {
    clearPending();
    return;
  }
  const destination = await exchangeCode(returned.code, pending.verifier)
    // Offline or unreachable is the same outcome as a refusal: the person lands
    // on the sign-in page's failed result and starts again.
    .catch(() => null)
    .finally(clearPending);
  window.location.assign(destination ?? SIGN_IN_FAILED);
}

function interceptOAuthClick(event: MouseEvent): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  const anchor = (event.target as Element | null)?.closest?.('a[href]');
  if (anchor instanceof HTMLAnchorElement && openOAuthInShell(anchor.href)) {
    event.preventDefault();
  }
}

/**
 * Wire the shell: divert OAuth links, and listen for the browser's return,
 * including the launch link when the OS had reclaimed the app meanwhile.
 * Returns the teardown.
 */
export async function installShellBridge(): Promise<() => void> {
  const { App } = await import('@capacitor/app');
  document.addEventListener('click', interceptOAuthClick, true);
  const listener = await App.addListener('appUrlOpen', ({ url }) => {
    void handleNativeReturn(url);
  });
  const launch = await App.getLaunchUrl();
  if (launch?.url) void handleNativeReturn(launch.url);
  return () => {
    document.removeEventListener('click', interceptOAuthClick, true);
    void listener.remove();
  };
}
