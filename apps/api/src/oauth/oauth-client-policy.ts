import { errors } from 'oidc-provider';

/**
 * Registration policy for dynamically registered clients (RFC 7591,
 * spec §4). The authorization-server library validates client metadata
 * against the RFCs; this adds the three things that are ours to decide:
 *
 *   1. Every client is PUBLIC. Authentication is PKCE, so there is no
 *      client secret to issue, store or leak. A client that asks for a
 *      confidential method is registered as public instead — RFC 7591
 *      §3.2.1 lets the server replace requested values, and the response
 *      tells the client what it got.
 *   2. Redirect URIs are `https`, or `http` on a loopback address for
 *      desktop apps (RFC 8252 §7.3). Nothing else — no plain `http` to a
 *      real host, no custom schemes.
 *   3. A client with a loopback redirect is a native app, which is what
 *      makes the library ignore the port at authorization time (RFC 8252
 *      says the port is chosen when the request is made).
 *
 * Runs through `extraClientMetadata.validator`, which the library calls
 * BEFORE its own type checks — so every value here is still untrusted
 * input and is read defensively. Mutating `metadata` is the documented
 * way to set values.
 */

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Longest app name shown on the consent page and in Settings. */
const MAX_CLIENT_NAME = 80;
const MAX_SOFTWARE_FIELD = 100;

type Metadata = Record<string, unknown>;

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
}

export function applyClientRegistrationPolicy(metadata: Metadata): void {
  // 1. Public clients only.
  metadata.token_endpoint_auth_method = 'none';
  delete metadata.client_secret;
  delete metadata.client_secret_expires_at;

  // Scopes are decided per request on the consent page, never pinned at
  // registration: a registered `scope` would only narrow what the same
  // client may later ask a person for, and clients send values here
  // (`claudeai`) that are not ours.
  delete metadata.scope;

  // The name is shown to a person deciding whether to trust the app.
  if (typeof metadata.client_name === 'string') {
    const name = metadata.client_name.trim().slice(0, MAX_CLIENT_NAME);
    if (name) metadata.client_name = name;
    else delete metadata.client_name;
  }
  for (const key of ['software_id', 'software_version']) {
    const value = boundedString(metadata[key], MAX_SOFTWARE_FIELD);
    if (value === undefined) delete metadata[key];
    else metadata[key] = value;
  }

  // 2 + 3. Redirect URIs. A non-array or non-string entry is left for
  // the library's own validation to reject.
  if (!Array.isArray(metadata.redirect_uris)) return;
  let loopback = false;
  for (const uri of metadata.redirect_uris) {
    if (typeof uri !== 'string') continue;
    const parsed = URL.parse(uri);
    if (!parsed) continue;
    if (parsed.protocol === 'https:') continue;
    if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) {
      loopback = true;
      continue;
    }
    // A description starting with `redirect_uris` makes the library
    // answer RFC 7591's `invalid_redirect_uri`.
    throw new errors.InvalidClientMetadata(
      'redirect_uris must use https, or http on a loopback address',
    );
  }
  metadata.application_type = loopback ? 'native' : 'web';
}
