import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import {
  bearerAuthChallengeResponse,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
  verifyBearerToken,
} from '@modelcontextprotocol/server';
import type { Request, Response } from 'express';

import type { ConnectorClient } from '@declutrmail/shared/analytics/sanitize-product-event';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import {
  findAccessToken,
  touchGrantLastUsed,
  type VerifiedAccessToken,
} from '../oauth/oauth-store.js';
import { mcpAllowedFor, mcpResourceUrl } from './mcp-config.js';

/** Who an MCP request acts for. Set by `McpTokenGuard`. */
export interface McpPrincipal {
  userId: string;
  workspaceId: string;
  /** The grant behind the token — the "via Claude" origin of anything it does. */
  grantId: string;
  clientId: string;
  /** Which assistant, for the product funnel only. */
  client: ConnectorClient;
  scopes: readonly string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by McpTokenGuard on successful bearer auth. */
      mcpAuth?: McpPrincipal;
    }
  }
}

/**
 * McpTokenGuard (ADR-0048 rule 4) — bearer-token auth for `/mcp` ONLY.
 *
 * `/mcp` is an OAuth resource server. This guard replaces `JwtGuard` +
 * `CsrfGuard` there and nowhere else: browsers do not attach bearer
 * tokens on their own, so there is nothing for CSRF to defend, and the
 * cookie routes keep their guards unchanged.
 *
 * A request passes only with an access token that is known, unexpired,
 * unrevoked, under an unrevoked grant, and issued for this resource
 * (RFC 8707). Everything else is a 401 whose `WWW-Authenticate` header
 * points at the protected-resource metadata (RFC 9728) so a client can
 * find the authorization server and start over. Header parsing, the
 * audience and expiry checks and the challenge format are the MCP SDK's;
 * the lookup is ours.
 */
@Injectable()
export class McpTokenGuard implements CanActivate {
  private readonly logger = new Logger(McpTokenGuard.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const resource = new URL(mcpResourceUrl());
    const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resource);

    let verified: VerifiedAccessToken | undefined;
    try {
      await verifyBearerToken(req.headers.authorization, {
        verifier: {
          verifyAccessToken: async (token) => {
            const found = await findAccessToken(this.db, token);
            // In beta, a token of someone not (or no longer) on the list is
            // answered as invalid: the app asks them to connect again, and
            // the consent page refuses.
            if (!found || !URL.canParse(found.resource) || !mcpAllowedFor(found.userId)) {
              throw new OAuthError(OAuthErrorCode.InvalidToken, 'Token is not valid');
            }
            verified = found;
            return {
              token,
              clientId: found.clientId,
              scopes: found.scopes,
              expiresAt: Math.floor(found.expiresAt.getTime() / 1000),
              resource: new URL(found.resource),
            };
          },
        },
        expectedResource: resource,
        resourceMetadataUrl,
      });
    } catch (error) {
      const challenge = bearerAuthChallengeResponse(error, { resourceMetadataUrl });
      const header = challenge.headers.get('www-authenticate');
      // Not an authentication failure (a database error, say): let the
      // exception filter report it as what it is.
      if (!header) throw error;
      res.setHeader('WWW-Authenticate', header);
      if (challenge.status === 403) throw new ForbiddenException('Insufficient scope.');
      throw new UnauthorizedException('Invalid or expired access token.');
    }
    if (!verified) throw new UnauthorizedException('Invalid or expired access token.');

    req.mcpAuth = {
      userId: verified.userId,
      workspaceId: verified.workspaceId,
      grantId: verified.grantId,
      clientId: verified.clientId,
      client: verified.client,
      scopes: verified.scopes,
    };
    // Presence telemetry for Settings → Connected apps. Never fails the
    // request, but a write that keeps failing would leave an app in use
    // showing "Not used yet", so it is logged.
    void touchGrantLastUsed(this.db, verified.grantId).catch((error: unknown) => {
      this.logger.warn(
        `last_used_at write failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    });
    return true;
  }
}

/** `@McpUser()` — the principal `McpTokenGuard` attached. */
export const McpUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): McpPrincipal => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.mcpAuth) {
      throw new UnauthorizedException('Route requires McpTokenGuard before resolving @McpUser().');
    }
    return req.mcpAuth;
  },
);
