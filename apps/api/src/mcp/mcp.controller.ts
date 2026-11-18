import { All, Controller, HttpException, HttpStatus, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import { McpEnabledGuard } from './mcp-enabled.guard.js';
import { McpRateLimitGuard } from './mcp-rate-limit.guard.js';
import { McpServerService } from './mcp-server.service.js';
import { McpTokenGuard, McpUser, type McpPrincipal } from './mcp-token.guard.js';

/**
 * `/mcp` — the connector's one endpoint (ADR-0048, spec §2 and §4).
 *
 * Guard order is the contract: the flag (404 while off, before anything
 * can reveal the route), a per-address limit (so an unauthenticated
 * caller cannot make the token lookup arbitrarily often), then the
 * bearer token. Only then does the MCP server see the request.
 *
 * POST only. The server is stateless — no sessions, no server-initiated
 * stream — so `GET` and `DELETE` have nothing to do.
 */
@Controller('mcp')
@UseGuards(McpEnabledGuard, McpRateLimitGuard, McpTokenGuard)
export class McpController {
  constructor(private readonly server: McpServerService) {}

  @All()
  async handle(
    @Req() req: Request,
    @Res() res: Response,
    @McpUser() principal: McpPrincipal,
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new HttpException('Method not allowed.', HttpStatus.METHOD_NOT_ALLOWED);
    }
    await this.server.handle(req, res, principal);
  }
}
