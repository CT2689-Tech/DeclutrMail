import { Controller, Get, Header, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  buildOAuthProtectedResourceMetadata,
  type OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/server';
import type { Request, Response } from 'express';

import { RateLimit } from '../common/rate-limit/index.js';
import { MCP_SCOPES, mcpResourceUrl, oauthIssuer } from '../mcp/mcp-config.js';
import { McpEnabledGuard } from '../mcp/mcp-enabled.guard.js';
import { OAUTH_ROUTES, OAuthProviderService } from './oauth-provider.service.js';

/**
 * Root paths (no `/api` prefix) this controller and `McpController` own.
 * `main.ts` excludes them from the global prefix: discovery documents
 * live at the origin root by RFC, and the spec puts `/oauth/*` and `/mcp`
 * beside them.
 */
export const MCP_ROOT_ROUTES: readonly string[] = [
  '.well-known/oauth-protected-resource',
  '.well-known/oauth-protected-resource/mcp',
  '.well-known/oauth-authorization-server',
  'oauth/register',
  'oauth/authorize',
  'oauth/authorize/:uid',
  'oauth/token',
  'oauth/revoke',
  'mcp',
];

/**
 * Per-IP abuse backstops, not user quotas. Hosted clients (Claude,
 * ChatGPT) reach these endpoints from a small set of addresses on behalf
 * of everyone using them, so the ceilings sit far above one person's
 * traffic. Registration is the tightest: it is the only unauthenticated
 * route that writes a row.
 */
const REGISTER_LIMIT = { bucket: 'default', limit: 60, windowSec: 60 } as const;
const TOKEN_LIMIT = { bucket: 'default', limit: 600, windowSec: 60 } as const;
const AUTHORIZE_LIMIT = { bucket: 'default', limit: 120, windowSec: 60 } as const;

/**
 * The OAuth protocol endpoints (spec §4), served by `oidc-provider`.
 *
 * Each handler is a doorway and nothing more: the flag guard, a rate
 * limit, then the request goes to the library untouched. The one
 * document built here is the RFC 9728 protected-resource metadata,
 * because that describes the resource server (`/mcp`), not the
 * authorization server.
 */
@Controller()
@UseGuards(McpEnabledGuard)
export class OAuthProtocolController {
  constructor(private readonly oauth: OAuthProviderService) {}

  /** RFC 9728 — tells a client which authorization server guards `/mcp`. */
  @Get(['.well-known/oauth-protected-resource', '.well-known/oauth-protected-resource/mcp'])
  @Header('Cache-Control', 'public, max-age=300')
  @RateLimit(AUTHORIZE_LIMIT)
  protectedResource(): OAuthProtectedResourceMetadata {
    const issuer = oauthIssuer();
    return buildOAuthProtectedResourceMetadata({
      oauthMetadata: {
        issuer,
        authorization_endpoint: `${issuer}${OAUTH_ROUTES.authorization}`,
        token_endpoint: `${issuer}${OAUTH_ROUTES.token}`,
        response_types_supported: ['code'],
      },
      resourceServerUrl: new URL(mcpResourceUrl()),
      scopesSupported: [...MCP_SCOPES],
      resourceName: 'DeclutrMail',
    });
  }

  /** RFC 8414 — authorization-server metadata. */
  @Get('.well-known/oauth-authorization-server')
  @RateLimit(AUTHORIZE_LIMIT)
  metadata(@Req() req: Request, @Res() res: Response): void {
    this.oauth.handle(req, res);
  }

  /** RFC 7591 — dynamic client registration. */
  @Post('oauth/register')
  @RateLimit(REGISTER_LIMIT)
  register(@Req() req: Request, @Res() res: Response): void {
    this.oauth.handle(req, res);
  }

  /** Authorization endpoint: parks the request and redirects to consent. */
  @Get('oauth/authorize')
  @RateLimit(AUTHORIZE_LIMIT)
  authorize(@Req() req: Request, @Res() res: Response): void {
    this.oauth.handle(req, res);
  }

  /** Resume after the consent decision: issues the code or the error. */
  @Get('oauth/authorize/:uid')
  @RateLimit(AUTHORIZE_LIMIT)
  resume(@Req() req: Request, @Res() res: Response): void {
    this.oauth.handle(req, res);
  }

  /** Token endpoint: `authorization_code` (PKCE S256) and `refresh_token`. */
  @Post('oauth/token')
  @RateLimit(TOKEN_LIMIT)
  token(@Req() req: Request, @Res() res: Response): void {
    this.oauth.handle(req, res);
  }

  /** RFC 7009 — token revocation. */
  @Post('oauth/revoke')
  @RateLimit(TOKEN_LIMIT)
  revoke(@Req() req: Request, @Res() res: Response): void {
    this.oauth.handle(req, res);
  }
}
