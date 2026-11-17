import { type CanActivate, Injectable, NotFoundException } from '@nestjs/common';

import { mcpEnabled } from './mcp-config.js';

/**
 * 404s every connector route while `MCP_ENABLED` is off (spec §10).
 *
 * Listed FIRST on each gated controller so a disabled deployment answers
 * 404 before any auth guard can answer 401 — the route must not reveal
 * that it exists.
 */
@Injectable()
export class McpEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!mcpEnabled()) throw new NotFoundException();
    return true;
  }
}
