import {
  All,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { McpEnabledGuard } from './mcp-enabled.guard.js';
import { McpTokenGuard } from './mcp-token.guard.js';

/** JSON-RPC 2.0 "Method not found". */
const METHOD_NOT_FOUND = -32601;

/**
 * `/mcp` — the resource the OAuth flow protects (ADR-0048, spec §4).
 *
 * THIS PR SHIPS THE DOOR, NOT THE ROOM. Authentication is real and
 * complete: the flag guard, then `McpTokenGuard`. The connector itself —
 * the Streamable HTTP transport and the ten tools — is PR 2
 * (`apps/api/src/mcp/`, spec §10). Until then an authenticated request
 * is answered truthfully: the server has no methods, so every JSON-RPC
 * call is "Method not found". Nothing is faked and no tool is listed.
 */
@Controller('mcp')
@UseGuards(McpEnabledGuard, McpTokenGuard)
export class McpController {
  @All()
  @HttpCode(200)
  handle(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): {
    jsonrpc: '2.0';
    id: string | number | null;
    error: { code: number; message: string };
  } {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new HttpException('Method not allowed.', HttpStatus.METHOD_NOT_ALLOWED);
    }
    const body = req.body as { id?: unknown } | undefined;
    const id = typeof body?.id === 'string' || typeof body?.id === 'number' ? body.id : null;
    return {
      jsonrpc: '2.0',
      id,
      error: { code: METHOD_NOT_FOUND, message: 'Method not found' },
    };
  }
}
