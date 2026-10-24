// Native sign-in contract (ADR-0049). One set of literals and parsers shared
// by the API that builds the return link and the web app, running inside the
// native shell, that reads it, so the two cannot drift apart.
//
// The flow, in one paragraph. The shell cannot run Google OAuth in its own
// WebView (Google rejects embedded user agents), so the web asks the system
// browser to run the existing flow. The browser never receives a session. When
// the flow ends, the API sends the browser to a custom-scheme link that opens
// the app:
//
//   com.declutrmail.app://auth/return?code=<code>   a session is waiting
//   com.declutrmail.app://auth/return?to=<path>     no session; go to <path>
//
// A session return carries only a one-time code. The app proves it started the
// flow by presenting the PKCE verifier (RFC 7636 / RFC 8252) to the exchange
// endpoint; the destination comes back from the exchange, never from the link.
// Another app that claims the same scheme sees a code it cannot use.

import { z } from 'zod';

/**
 * Reverse-domain scheme (RFC 8252 §7.1). The iOS URL type and the Android
 * intent filter must carry exactly this value; a test in apps/mobile pins it.
 */
export const NATIVE_APP_SCHEME = 'com.declutrmail.app';
const RETURN_HOST = 'auth';
const RETURN_PATH = '/return';

/** 32 random bytes, base64url. Opaque to the app. */
export const NATIVE_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** S256 of the verifier: SHA-256 is 32 bytes, base64url without padding. */
export const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636 §4.1: unreserved characters, 43 to 128 of them. */
export const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

/** How long the exchange stays open after the browser flow finishes. */
export const NATIVE_HANDOFF_TTL_MS = 60_000;
/** How long a connect-start ticket stays valid between the app and the browser. */
export const NATIVE_START_TICKET_TTL_MS = 5 * 60_000;

const PATH_MAX = 2048;

/**
 * A same-origin relative path: the only destination the app will navigate its
 * WebView to from a link. Rejects absolute and protocol-relative URLs,
 * backslashes, control characters and anything `URL` would resolve elsewhere.
 */
export function isNativeSafePath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > PATH_MAX ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    [...value].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
  ) {
    return false;
  }
  try {
    return new URL(value, 'https://declutrmail.invalid').origin === 'https://declutrmail.invalid';
  } catch {
    return false;
  }
}

export type NativeReturn = { kind: 'session'; code: string } | { kind: 'navigate'; to: string };

/** The custom-scheme link that brings the person back to the app. */
export function buildNativeReturnUrl(result: NativeReturn): string {
  const base = `${NATIVE_APP_SCHEME}://${RETURN_HOST}${RETURN_PATH}`;
  if (result.kind === 'session') {
    if (!NATIVE_CODE_PATTERN.test(result.code)) {
      throw new Error('Native return code is not well formed.');
    }
    return `${base}?${new URLSearchParams({ code: result.code })}`;
  }
  if (!isNativeSafePath(result.to)) throw new Error('Native return path is not a safe path.');
  return `${base}?${new URLSearchParams({ to: result.to })}`;
}

/**
 * Read a return link back. Anything that is not exactly one of the two shapes
 * above is `null`: wrong scheme, host or path, both or neither parameter,
 * repeated or extra parameters, a malformed code, an unsafe path.
 */
export function parseNativeReturnUrl(raw: unknown): NativeReturn | null {
  if (typeof raw !== 'string' || raw.length > PATH_MAX + 128) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.protocol !== `${NATIVE_APP_SCHEME}:` ||
    url.host !== RETURN_HOST ||
    url.pathname !== RETURN_PATH ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return null;
  }
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1) return null;
  const code = url.searchParams.get('code');
  if (keys[0] === 'code') {
    return code !== null && NATIVE_CODE_PATTERN.test(code) ? { kind: 'session', code } : null;
  }
  const to = url.searchParams.get('to');
  if (keys[0] === 'to') return isNativeSafePath(to) ? { kind: 'navigate', to } : null;
  return null;
}

/** POST /api/auth/native/exchange body. */
export const nativeExchangeRequestSchema = z
  .object({
    code: z.string().regex(NATIVE_CODE_PATTERN),
    verifier: z.string().regex(PKCE_VERIFIER_PATTERN),
  })
  .strict();
export type NativeExchangeRequest = z.infer<typeof nativeExchangeRequestSchema>;

/** Where the signed-in app goes next. Server-decided, never taken from the link. */
export interface NativeExchangeResponse {
  returnTo: string;
}

/**
 * The targets a connect ticket carries. The app sends them as the query of
 * `POST /api/auth/google/native/connect-ticket`, the same optional parameters
 * `GET /api/auth/google/connect-mailbox/start` takes, because the app starts
 * the flow and the system browser, which holds no session, runs it. The API
 * validates ownership and status before it stores them here, and parses them
 * again when the ticket is opened.
 */
export const nativeConnectTicketRequestSchema = z
  .object({
    reconnectMailboxId: z.string().uuid().optional(),
    reactivateMailboxId: z.string().uuid().optional(),
    billingReturnTo: z.string().max(1024).optional(),
  })
  .strict();
export type NativeConnectTicketRequest = z.infer<typeof nativeConnectTicketRequestSchema>;

/** The URL to open in the system browser. Single use, valid for a few minutes. */
export interface NativeConnectTicketResponse {
  url: string;
}
