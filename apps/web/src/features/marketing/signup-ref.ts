/**
 * First-touch `ref` capture for marketing CTAs (runbook Phase B).
 *
 * The cookie is the set-once store. OAuth start URLs read it at click
 * time so the value survives the Google hop. This module is not a
 * client component — server code may import the pure helpers.
 */

import {
  parseSignupAttributionRef,
  resolveFirstTouchRef,
  SIGNUP_REF_COOKIE,
  type SignupAttributionRef,
} from '@declutrmail/shared/contracts';

const MAX_AGE_SEC = 60 * 60 * 24 * 30;

function readCookieValue(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const prefix = `${SIGNUP_REF_COOKIE}=`;
  const part = document.cookie.split('; ').find((row) => row.startsWith(prefix));
  return part?.slice(prefix.length);
}

function writeCookie(ref: SignupAttributionRef): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${SIGNUP_REF_COOKIE}=${ref}; Path=/; Max-Age=${MAX_AGE_SEC}; SameSite=Lax${secure}`;
}

function readStorageValue(): string | undefined {
  try {
    return sessionStorage.getItem(SIGNUP_REF_COOKIE) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStorage(ref: SignupAttributionRef): void {
  try {
    sessionStorage.setItem(SIGNUP_REF_COOKIE, ref);
  } catch {
    // Private mode can throw; the cookie is the real store.
  }
}

export function readCapturedSignupRef(): SignupAttributionRef | undefined {
  return (
    parseSignupAttributionRef(readCookieValue()) ?? parseSignupAttributionRef(readStorageValue())
  );
}

export function captureSignupRef(
  pathname: string,
  search: string,
): SignupAttributionRef | undefined {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const existing = readCapturedSignupRef();
  const resolved = resolveFirstTouchRef({
    existing,
    queryRef: params.get('ref'),
    pathname,
  });
  if (resolved && existing !== resolved) {
    writeCookie(resolved);
    writeStorage(resolved);
  }
  return resolved;
}

/**
 * Append an allowlisted `ref` to the OAuth start URL. Does not overwrite
 * a ref already on the href (set-once at the URL too).
 */
export function withSignupRef(
  href: string,
  ref: SignupAttributionRef | undefined = readCapturedSignupRef(),
): string {
  if (!ref || !href.includes('/api/auth/google/start')) return href;
  const hashIndex = href.indexOf('#');
  const withoutHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex);
  const qIndex = withoutHash.indexOf('?');
  const path = qIndex === -1 ? withoutHash : withoutHash.slice(0, qIndex);
  const params = new URLSearchParams(qIndex === -1 ? '' : withoutHash.slice(qIndex + 1));
  if (!params.has('ref')) params.set('ref', ref);
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ''}${hash}`;
}

/** Share URL for the simulator. Recipients get `ref=simulator`; set-once capture protects the sharer's own first touch. */
export function simulatorShareUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/inbox-simulator?ref=simulator`;
}
