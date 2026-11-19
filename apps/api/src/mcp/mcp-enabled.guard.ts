import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';

import { mcpAllowedFor, mcpEnabled } from './mcp-config.js';

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

/**
 * In beta, 404s the session routes (Settings → Connected apps, the
 * confirm page) for anyone not on the list — the same answer the flag
 * gives when it is off. Listed after `JwtGuard`, which sets the user.
 */
@Injectable()
export class McpUserAllowedGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user || !mcpAllowedFor(user.userId)) throw new NotFoundException();
    return true;
  }
}
