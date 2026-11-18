import { createHmac, generateKeyPairSync } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type Configuration, errors, type KoaContextWithOIDC, Provider } from 'oidc-provider';

import { ACCESS_COOKIE } from '../auth/jwt.guard.js';
import { JwtService } from '../auth/jwt.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import {
  ACCESS_TOKEN_TTL_SEC,
  AUTH_CODE_TTL_SEC,
  INTERACTION_TTL_SEC,
  MCP_SCOPES,
  REFRESH_TOKEN_TTL_SEC,
  mcpEnabled,
  mcpResourceUrl,
  oauthIssuer,
} from '../mcp/mcp-config.js';
import { SecurityEventsService } from '../security-events/security-events.service.js';
import { applyClientRegistrationPolicy } from './oauth-client-policy.js';
import { createOAuthStorageAdapter, OAUTH_RESUME_PATH } from './oauth-storage.adapter.js';
import { findAuthorizableUser } from './oauth-store.js';

/** Paths the library serves. The controller mounts exactly these, at the host root. */
export const OAUTH_ROUTES = {
  metadata: '/.well-known/oauth-authorization-server',
  registration: '/oauth/register',
  authorization: OAUTH_RESUME_PATH,
  token: '/oauth/token',
  revocation: '/oauth/revoke',
} as const;

/** Where the library sends the browser when a person has to decide. */
export const INTERACTION_PATH = '/api/oauth/interactions';

/**
 * Largest request body the OAuth endpoints read. A registration with the
 * most redirect URIs the policy allows is under half of this; a token
 * request is a few hundred bytes.
 */
const MAX_BODY_BYTES = 8 * 1024;

/** Domain-separation label for the cookie-signing key derived below. */
const COOKIE_KEY_CONTEXT = 'declutrmail:oauth-interaction-cookies:v1';

/**
 * Discovery fields that describe OpenID Connect, which this server does
 * not offer: it never grants `openid` and never signs a token. The
 * library emits them because it is an OIDC implementation first.
 */
const OIDC_ONLY_METADATA = [
  'jwks_uri',
  'id_token_signing_alg_values_supported',
  'subject_types_supported',
  'claims_supported',
  'claim_types_supported',
  'claims_parameter_supported',
  'request_uri_parameter_supported',
] as const;

/**
 * The OAuth 2.1 authorization server for the MCP connector (ADR-0048
 * rule 4, spec §4) — a configured `oidc-provider` instance.
 *
 * `oidc-provider` implements the protocol: dynamic client registration
 * (RFC 7591), the authorization and token endpoints with PKCE (RFC 7636),
 * refresh rotation with reuse detection, revocation (RFC 7009), server
 * metadata (RFC 8414), resource indicators (RFC 8707) and loopback
 * redirects (RFC 8252). Nothing in this file re-implements any of that;
 * it states policy:
 *
 *   - public clients only, PKCE S256 required, `code` flow only;
 *   - opaque tokens — access 1 hour, refresh 30 days, rotated on every
 *     use, the whole grant revoked on reuse;
 *   - one resource, `…/mcp`: every access token is bound to it, and any
 *     other `resource` is refused;
 *   - sign-in and consent are OURS: the library never keeps a login of
 *     its own (see `NoSessionStore`), so each authorization goes through
 *     the consent page, which trusts only DeclutrMail's session cookie —
 *     and the code is released only to a browser that still holds the
 *     approver's session (see `findAccount`).
 *
 * Built once, on first use, and only when `MCP_ENABLED` is on — a
 * disabled deployment needs none of the configuration and constructs
 * nothing.
 */
@Injectable()
export class OAuthProviderService implements OnModuleInit {
  private readonly logger = new Logger(OAuthProviderService.name);
  private instance: Provider | undefined;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly securityEvents: SecurityEventsService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
  ) {}

  /** Fail at boot, not on the first person's request, when enabled but misconfigured. */
  onModuleInit(): void {
    if (mcpEnabled()) void this.provider;
  }

  get provider(): Provider {
    this.instance ??= this.build();
    return this.instance;
  }

  /**
   * Hand a request to the library. Called from the protocol controller
   * for exactly the routes in `OAUTH_ROUTES`.
   */
  handle(req: IncomingMessage & { rawBody?: Buffer; body?: unknown }, res: ServerResponse): void {
    const refusal = malformedRequest(req);
    if (refusal) {
      res.statusCode = refusal.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'invalid_request', error_description: refusal.reason }));
      return;
    }
    // The library builds the URLs it advertises, and decides whether its
    // cookies are Secure, from the request's host and protocol. Both are
    // the caller's to choose, so they are replaced with the configured
    // public origin: what this server advertises never follows a header.
    const origin = new URL(oauthIssuer());
    req.headers.host = origin.host;
    req.headers['x-forwarded-proto'] = origin.protocol.slice(0, -1);
    delete req.headers['x-forwarded-host'];
    // Nest has already read the body. Give the library the bytes that
    // were sent rather than Nest's parse of them, so it applies its own
    // parsing and duplicate-parameter rules.
    if (Buffer.isBuffer(req.rawBody)) req.body = req.rawBody;
    void this.provider.callback()(req, res);
  }

  private build(): Provider {
    const issuer = oauthIssuer();
    const resource = mcpResourceUrl();
    const scope = MCP_SCOPES.join(' ');
    const db = this.db;

    const configuration: Configuration = {
      adapter: createOAuthStorageAdapter(db, (reuse) => {
        // The grant is already revoked; this is the audit row saying why.
        void this.securityEvents.record({
          eventType: 'connected_app.token_reuse_revoked',
          severity: 'warning',
          userId: reuse.userId,
          workspaceId: reuse.workspaceId,
          payload: { kind: reuse.kind, clientId: reuse.clientId, grantId: reuse.grantId },
        });
      }),

      // --- what is offered -------------------------------------------
      responseTypes: ['code'],
      clientAuthMethods: ['none'],
      clientDefaults: {
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        id_token_signed_response_alg: 'ES256',
      },
      // Our scopes belong to the resource server below. This list is the
      // library's OpenID scope list, and it stays empty.
      scopes: [],
      pkce: { required: () => true },
      routes: {
        authorization: OAUTH_ROUTES.authorization,
        token: OAUTH_ROUTES.token,
        registration: OAUTH_ROUTES.registration,
        revocation: OAUTH_ROUTES.revocation,
      },
      features: {
        devInteractions: { enabled: false },
        userinfo: { enabled: false },
        rpInitiatedLogout: { enabled: false },
        pushedAuthorizationRequests: { enabled: false },
        // The resource server accepts plain bearer tokens only, so a
        // sender-constrained token would be a promise it does not keep.
        dPoP: { enabled: false },
        registration: {
          enabled: true,
          initialAccessToken: false,
          issueRegistrationAccessToken: false,
        },
        revocation: {
          enabled: true,
          // A client may revoke only its own tokens. Anyone else gets the
          // normal empty 200 with nothing changed, so the endpoint cannot
          // be used to test whether a token exists.
          allowedPolicy: async (_ctx, client, token) => token.clientId === client.clientId,
        },
        resourceIndicators: {
          enabled: true,
          // A client that names no resource gets the only one there is.
          defaultResource: () => resource,
          useGrantedResource: () => true,
          getResourceServerInfo: (_ctx, indicator) => {
            if (indicator !== resource) throw new errors.InvalidTarget();
            return { scope, accessTokenTTL: ACCESS_TOKEN_TTL_SEC, accessTokenFormat: 'opaque' };
          },
        },
      },

      // --- tokens ----------------------------------------------------
      ttl: {
        AccessToken: ACCESS_TOKEN_TTL_SEC,
        RefreshToken: REFRESH_TOKEN_TTL_SEC,
        AuthorizationCode: AUTH_CODE_TTL_SEC,
        Interaction: INTERACTION_TTL_SEC,
        // Neither is ever stored: sessions go nowhere, grants are ours.
        Session: INTERACTION_TTL_SEC,
        Grant: REFRESH_TOKEN_TTL_SEC,
      },
      rotateRefreshToken: true,
      issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed('refresh_token'),
      // Tokens answer to the grant, never to a library session.
      expiresWithSession: async () => false,

      // --- people ----------------------------------------------------
      findAccount: async (ctx, sub) => {
        const user = await findAuthorizableUser(db, sub);
        // Resume is the step that releases the code. Approve was pressed
        // under a DeclutrMail session; the library's own cookies only
        // prove which REQUEST is being resumed, and a cookie can be
        // planted from a sibling host. So the code goes only to a browser
        // that still holds the approver's session, for an account that
        // can still be acted for. Refusing here sends `access_denied`
        // back to the app instead of a code.
        if (ctx.oidc?.route === 'resume') {
          if (!user || !(await this.holdsSessionFor(ctx.req, sub))) {
            throw new errors.AccessDenied('the approving session is not present');
          }
        }
        if (!user) return undefined;
        return { accountId: user.userId, claims: async () => ({ sub: user.userId }) };
      },
      interactions: {
        url: (_ctx, interaction) => `${INTERACTION_PATH}/${interaction.uid}`,
      },
      cookies: {
        keys: [cookieSigningKey()],
        short: { httpOnly: true, sameSite: 'lax' },
        long: { httpOnly: true, sameSite: 'lax' },
      },

      // --- clients ---------------------------------------------------
      extraClientMetadata: {
        // RFC 7591 fields the library does not know. Declaring them is
        // also what makes it call the validator.
        properties: ['software_id', 'software_version'],
        validator: (_ctx, key, _value, metadata) => {
          // Called once per declared property; the policy runs once.
          if (key === 'software_id') applyClientRegistrationPolicy(metadata);
        },
      },
      // No cross-origin browser access to the client endpoints: MCP
      // clients call them server to server or from native apps (spec §4).
      clientBasedCORS: () => false,

      // The unused signing key. The library insists on one; nothing is
      // ever signed with it, so a fresh per-process key is enough and
      // there is no secret to manage.
      jwks: { keys: [ephemeralSigningKey()] },

      renderError: (ctx, out) => {
        ctx.type = 'text/plain';
        ctx.body =
          'DeclutrMail could not continue this connection request. ' +
          `Go back to your app and try again. (${out.error})`;
      },
    };

    const provider = new Provider(issuer, configuration);
    // Cloud Run terminates TLS; trust its X-Forwarded-Proto.
    provider.proxy = true;

    provider.use(async (ctx, next) => {
      // A repeated `scope` parameter is malformed; leave it for the
      // library to refuse rather than paper over it with a default.
      // The library's router ignores case and a trailing slash; so does
      // this, or those spellings would skip the scope handling.
      const { scope: requested } = ctx.query;
      if (
        ctx.method === 'GET' &&
        ctx.path.replace(/\/+$/, '').toLowerCase() === OAUTH_ROUTES.authorization &&
        !Array.isArray(requested)
      ) {
        ctx.query = { ...ctx.query, scope: grantableScope(requested) };
      }
      await next();
      if (ctx.oidc?.route === 'discovery' && isRecord(ctx.body)) {
        for (const key of OIDC_ONLY_METADATA) delete ctx.body[key];
        ctx.body.scopes_supported = [...MCP_SCOPES];
        // The code comes back in the query string. The library's other
        // modes are not offered: `form_post` needs an inline script this
        // API's content security policy does not allow.
        ctx.body.response_modes_supported = ['query'];
      }
    });

    // The library answers its own errors, so a failure inside it never
    // reaches AllExceptionsFilter. Without this, a broken token endpoint
    // would disconnect every app with nothing but a log line to show for it.
    provider.on('server_error', (ctx: KoaContextWithOIDC, error: Error) => {
      const route = ctx.oidc?.route ?? 'unknown';
      // A failed query's message carries its parameters — whatever the
      // caller sent. Report the driver's reason, which names none of them.
      const reported = error.cause instanceof Error ? error.cause : error;
      this.logger.error(
        JSON.stringify({
          kind: 'oauth.server_error',
          route,
          error: error.name,
          message: reported.message,
        }),
      );
      void import('@sentry/node')
        .then((Sentry) => {
          Sentry.withScope((scope) => {
            scope.setLevel('error');
            scope.setTag('oauth_route', route);
            Sentry.captureException(reported);
          });
        })
        .catch(() => {
          // Sentry is unavailable; the log line above is the record.
        });
    });

    return provider;
  }

  /** True when this browser request carries a live DeclutrMail session for `userId`. */
  private async holdsSessionFor(req: IncomingMessage, userId: string): Promise<boolean> {
    const cookies = (req as { cookies?: Record<string, unknown> }).cookies;
    const token = cookies?.[ACCESS_COOKIE];
    if (typeof token !== 'string') return false;
    let claims;
    try {
      claims = await this.jwt.verify(token, 'access');
    } catch {
      // Expired, forged or the wrong kind of token: not a session.
      return false;
    }
    return claims.sub === userId && (await this.sessions.lookupByJti(claims.jti)) !== null;
  }
}

/**
 * Requests refused before the library reads them. Postgres cannot store
 * U+0000 in text or jsonb, so a value carrying one would otherwise fail
 * at the first query and come back as a 500; and nothing these endpoints
 * accept needs a large body.
 */
function malformedRequest(
  req: IncomingMessage & { rawBody?: Buffer },
): { status: number; reason: string } | undefined {
  const body = Buffer.isBuffer(req.rawBody) ? req.rawBody : undefined;
  if (body && body.length > MAX_BODY_BYTES) {
    return { status: 413, reason: 'request body is too large' };
  }
  const nul = /%00|\\u0000/i;
  if (
    nul.test(req.url ?? '') ||
    (body && (body.includes(0) || nul.test(body.toString('latin1'))))
  ) {
    return { status: 400, reason: 'null characters are not allowed' };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The scope an authorization request is processed with: the requested
 * scopes this server can grant, or all of them when the request names
 * none it knows (RFC 6749 §3.3 — a server may ignore requested scope
 * and apply a default; the token response states what was granted).
 * Clients send `openid`, `offline_access` and names of their own; none
 * of those is ours to grant, and the consent page shows the result.
 */
export function grantableScope(requested: unknown): string {
  const asked = typeof requested === 'string' ? requested.split(' ') : [];
  const known = MCP_SCOPES.filter((name) => asked.includes(name));
  return (known.length > 0 ? known : MCP_SCOPES).join(' ');
}

/**
 * Key for the library's signed interaction cookies, derived from the
 * mandatory `JWT_ACCESS_SECRET` with its own context label — the same
 * construction `JwtService` uses for OAuth state. A leaked cookie key
 * therefore reveals nothing about session-token signing, and no new
 * secret has to be provisioned.
 */
function cookieSigningKey(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET is missing or shorter than 32 bytes.');
  }
  return createHmac('sha256', secret).update(COOKIE_KEY_CONTEXT).digest('base64url');
}

function ephemeralSigningKey(): Record<string, unknown> {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { ...privateKey.export({ format: 'jwk' }), use: 'sig' };
}
