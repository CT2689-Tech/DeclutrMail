import { errors } from 'oidc-provider';

/**
 * Registration policy for dynamically registered clients (RFC 7591,
 * spec §4). The authorization-server library validates client metadata
 * against the RFCs; this adds the things that are ours to decide:
 *
 *   1. Every client is PUBLIC. Authentication is PKCE, so there is no
 *      client secret to issue, store or leak. A client that asks for a
 *      confidential method is registered as public instead — RFC 7591
 *      §3.2.1 lets the server replace requested values, and the response
 *      tells the client what it got.
 *   2. Only the metadata this server uses is kept. Registration is open
 *      to anyone, so every other field is dropped before the library
 *      sees it: several are URLs it would fetch (`sector_identifier_uri`,
 *      `jwks_uri`), and the rest is storage an anonymous caller would
 *      get to fill.
 *   3. Redirect URIs are `https`, or `http` on a loopback address for
 *      desktop apps (RFC 8252 §7.3). Nothing else — no plain `http` to a
 *      real host, no custom schemes — and a bounded number of them.
 *   4. A client with a loopback redirect is a native app, which is what
 *      makes the library ignore the port at authorization time (RFC 8252
 *      says the port is chosen when the request is made).
 *
 * Runs through `extraClientMetadata.validator`, which the library calls
 * BEFORE its own type checks — so every value here is still untrusted
 * input and is read defensively. Mutating `metadata` is the documented
 * way to set values; the library re-applies its defaults afterwards. It
 * calls the validator both when a client registers and whenever it
 * loads a stored one; only a registration is ever refused.
 */

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Everything a registration may carry. `client_id*` are set by the library. */
const KEPT_METADATA: ReadonlySet<string> = new Set([
  'client_id',
  'client_id_issued_at',
  'redirect_uris',
  'client_name',
  'grant_types',
  'response_types',
  'token_endpoint_auth_method',
  'application_type',
  'software_id',
  'software_version',
]);

/** Longest app name shown on the consent page and in Settings. */
const MAX_CLIENT_NAME = 80;
const MAX_SOFTWARE_FIELD = 100;
const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LENGTH = 255;

/**
 * What may not be stored or shown: control characters (Postgres cannot
 * hold U+0000), invisible format characters, and unpaired surrogates
 * (not valid text; Postgres refuses them in jsonb).
 */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}]/u;
/** For a name a person reads: also every character that renders as nothing. */
const INVISIBLE_ALL = /[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}]/gu;
/** More than two combining marks on one character is decoration, not a name. */
const STACKED_MARKS = /(\p{M}{2})\p{M}+/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

type Metadata = Record<string, unknown>;

/** A string that can be stored and shown as it is. */
function isPlainText(value: string): boolean {
  return !UNPRINTABLE.test(value);
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || !isPlainText(value)) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
}

/**
 * The name a person reads when deciding whether to trust the app.
 * Invisible characters are removed rather than refused — a text
 * direction override can make one name render as another — and the cut
 * is by character, so it never splits one in half. A name with no
 * letter or digit left is no name: the app is shown as unnamed.
 */
function displayName(value: string): string {
  const visible = value.replace(INVISIBLE_ALL, '').replace(STACKED_MARKS, '$1').trim();
  const name = [...visible].slice(0, MAX_CLIENT_NAME).join('').trim();
  return LETTER_OR_DIGIT.test(name) ? name : '';
}

export function applyClientRegistrationPolicy(
  metadata: Metadata,
  { registering }: { registering: boolean },
): void {
  // 2. Keep only what this server uses.
  for (const key of Object.keys(metadata)) {
    if (!KEPT_METADATA.has(key)) delete metadata[key];
  }

  // 1. Public clients only.
  metadata.token_endpoint_auth_method = 'none';

  // The library runs this again each time it loads a stored client. The
  // two rules above are safe to re-apply; the rest judged the request
  // that registered it, and refusing now would lock out a connected app.
  if (!registering) return;

  if (typeof metadata.client_name === 'string') {
    const name = displayName(metadata.client_name);
    if (name) metadata.client_name = name;
    else delete metadata.client_name;
  }
  for (const key of ['software_id', 'software_version']) {
    const value = boundedString(metadata[key], MAX_SOFTWARE_FIELD);
    if (value === undefined) delete metadata[key];
    else metadata[key] = value;
  }

  // 3 + 4. Redirect URIs. A non-array or non-string entry is left for
  // the library's own validation to reject. A description starting with
  // `redirect_uris` makes the library answer RFC 7591's
  // `invalid_redirect_uri`.
  if (!Array.isArray(metadata.redirect_uris)) return;
  if (metadata.redirect_uris.length > MAX_REDIRECT_URIS) {
    throw new errors.InvalidClientMetadata(
      `redirect_uris must not list more than ${MAX_REDIRECT_URIS} URIs`,
    );
  }
  let loopback = false;
  for (const uri of metadata.redirect_uris) {
    if (typeof uri !== 'string') continue;
    if (uri.length > MAX_REDIRECT_URI_LENGTH || !isPlainText(uri)) {
      throw new errors.InvalidClientMetadata(
        `redirect_uris must be plain text of at most ${MAX_REDIRECT_URI_LENGTH} characters`,
      );
    }
    if (!URL.canParse(uri)) continue;
    const parsed = new URL(uri);
    if (parsed.protocol === 'https:') continue;
    if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) {
      loopback = true;
      continue;
    }
    throw new errors.InvalidClientMetadata(
      'redirect_uris must use https, or http on a loopback address',
    );
  }
  metadata.application_type = loopback ? 'native' : 'web';
}
