import { CONNECTOR_SCOPES } from '@declutrmail/shared/contracts';

/**
 * MCP connector configuration (ADR-0048, docs/spec/mcp-connector.md §10).
 *
 * `MCP_ENABLED` gates the whole connector surface — the OAuth
 * authorization server, the consent and Connected-apps routes, and
 * `/mcp` — in three settings, each spelled exactly:
 *
 *   unset or anything else  off: every gated route answers 404, so a
 *                           disabled deployment is indistinguishable from
 *                           one that never shipped the connector
 *   `beta`                  on, for the user ids in `MCP_BETA_USER_IDS`
 *                           only; an empty list lets nobody in
 *   `true`                  on, for everyone
 *
 * Read per call, never cached: tests flip it, and a Cloud Run revision
 * gets a fresh process anyway.
 */
export type McpMode = 'off' | 'beta' | 'on';

export function mcpMode(): McpMode {
  const value = process.env.MCP_ENABLED;
  if (value === 'true') return 'on';
  if (value === 'beta') return 'beta';
  return 'off';
}

/** The routes exist: on for everyone, or on for the beta list. */
export function mcpEnabled(): boolean {
  return mcpMode() !== 'off';
}

/**
 * Whether this person may connect an app and use one. In beta, only the
 * listed user ids; anyone else meets the connector as if it were not
 * there. Separated by spaces, commas or semicolons: the deploy's own
 * env list is comma-delimited, so several ids go there space-separated.
 */
export function mcpAllowedFor(userId: string): boolean {
  const mode = mcpMode();
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  const listed = (process.env.MCP_BETA_USER_IDS ?? '')
    .split(/[\s,;]+/)
    .map((id) => id.toLowerCase())
    .filter(Boolean);
  return listed.includes(userId.toLowerCase());
}

/**
 * The API's public origin — the OAuth issuer identifier and the base of
 * every advertised endpoint. `API_URL` is the name the worker already
 * uses for it. Enabled without it is a boot-time misconfiguration, not a
 * request-time surprise: `OAuthProviderService` reads this on init.
 */
export function apiPublicUrl(): URL {
  const raw = process.env.API_URL;
  if (!raw) {
    throw new Error(
      'The MCP connector (MCP_ENABLED) requires API_URL, the public origin of this API.',
    );
  }
  const url = new URL(raw);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('API_URL must be https (http is accepted for localhost only).');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('API_URL must be an origin with no path, query or fragment.');
  }
  return url;
}

/** The issuer identifier: the API origin, no trailing slash (RFC 8414 §2). */
export function oauthIssuer(): string {
  return apiPublicUrl().origin;
}

/**
 * The RFC 8707 resource identifier of the MCP endpoint. Every access
 * token is audience-bound to exactly this value; `McpTokenGuard` refuses
 * any other.
 */
export function mcpResourceUrl(): string {
  return `${oauthIssuer()}/mcp`;
}

/** Where the web app lives — the consent page is `${webUrl()}/connect/authorize`. */
export function webUrl(): string {
  return (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

/** Scopes this resource server understands (spec §4). */
export const MCP_SCOPES: readonly string[] = CONNECTOR_SCOPES;

/** Token lifetimes, in seconds (spec §4). */
export const ACCESS_TOKEN_TTL_SEC = 60 * 60;
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;
export const AUTH_CODE_TTL_SEC = 60;
/** How long a person has to sign in and decide on the consent page. */
export const INTERACTION_TTL_SEC = 15 * 60;
