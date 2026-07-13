import { Injectable, UnauthorizedException, type CanActivate } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { SessionPrincipal } from '../../auth/sessions.service.js';
import { EntitlementsService } from './entitlements.service.js';

/**
 * InboxLimitGuard (D19/D81) — blocks a normal connect-mailbox OAuth START
 * when the workspace is already at its tier's connected-inbox limit,
 * BEFORE any Google consent screen renders.
 *
 * Must run AFTER `JwtGuard` in the guard list (it reads the principal
 * `JwtGuard` stamped on `req.user`). Throws 402 `INBOX_LIMIT_REACHED`
 * via `EntitlementsService.assertCanConnectMailbox` — the FE
 * AccountMenu reads the same limit from `/api/auth/me` + the shared
 * manifest and gates the affordance first, so this guard is the
 * defense-in-depth layer for direct hits. A non-empty
 * `reconnectMailboxId` is a hint, not authority: it only defers this UX
 * fast-fail so Google can re-authorize an already-counted active mailbox.
 * The controller validates + binds that target before consent and the
 * callback's activation-boundary check remains authoritative.
 */
@Injectable()
export class InboxLimitGuard implements CanActivate {
  constructor(private readonly entitlements: EntitlementsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: SessionPrincipal }>();
    if (!req.user) {
      // Defensive — only reachable if a route lists this guard without
      // JwtGuard before it.
      throw new UnauthorizedException('InboxLimitGuard requires JwtGuard to run first.');
    }
    const reconnectMailboxId = req.query?.['reconnectMailboxId'];
    if (typeof reconnectMailboxId === 'string' && reconnectMailboxId.trim().length > 0) {
      return true;
    }
    await this.entitlements.assertCanConnectMailbox(req.user.workspaceId);
    return true;
  }
}
