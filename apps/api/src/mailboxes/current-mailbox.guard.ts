import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';

import { UsersService } from '../users/users.service.js';
import { MailboxAccountsService } from './mailbox-accounts.service.js';

/** Header the FE sends when the user has explicitly picked a non-default mailbox. */
export const MAILBOX_HEADER = 'x-active-mailbox-id';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `CurrentMailboxGuard` after JwtGuard. */
      mailbox?: { id: string };
    }
  }
}

/**
 * CurrentMailboxGuard — resolves the active mailbox for the request
 * and attaches it as `req.mailbox`. Routes consume the value via the
 * `@CurrentMailbox()` param decorator.
 *
 * Resolution priority (highest first):
 *
 *   1. `X-Active-Mailbox-Id` request header — explicit per-request
 *      override, used when the FE wants to read a non-default mailbox
 *      (e.g., showing a snippet on a sender that lives in the
 *      secondary account).
 *   2. `users.preferences.activeMailboxId` — the user's chosen
 *      default, set via `PATCH /api/mailboxes/:id/active`.
 *   3. The single active mailbox if exactly one is connected.
 *
 * If two or more active mailboxes are connected and the user has no
 * preference + no header override, this throws **409 SELECT_MAILBOX**
 * so the FE can present the picker. Routes that need a mailbox MUST
 * use this guard AFTER `JwtGuard`.
 *
 * Ownership is enforced: a header value not in the user's workspace
 * is rejected as if it didn't exist.
 */
@Injectable()
export class CurrentMailboxGuard implements CanActivate {
  constructor(
    private readonly users: UsersService,
    private readonly mailboxes: MailboxAccountsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const principal = req.user;
    if (!principal) {
      throw new UnauthorizedException('CurrentMailboxGuard requires JwtGuard to run first.');
    }

    const summaries = await this.mailboxes.listByWorkspace(principal.workspaceId);
    const active = summaries.filter((m) => m.status === 'active');
    if (active.length === 0) {
      throw new ConflictException({
        code: 'NO_ACTIVE_MAILBOX',
        message: 'No active Gmail account is connected. Connect one to continue.',
      });
    }

    const headerValueRaw = req.headers[MAILBOX_HEADER];
    const headerValue = Array.isArray(headerValueRaw) ? headerValueRaw[0] : headerValueRaw;
    if (typeof headerValue === 'string' && headerValue.length > 0) {
      const owned = active.find((m) => m.id === headerValue);
      if (!owned) {
        throw new ConflictException({
          code: 'MAILBOX_NOT_OWNED',
          message: 'Selected mailbox is not connected to your workspace.',
        });
      }
      req.mailbox = { id: owned.id };
      return true;
    }

    const user = await this.users.findById(principal.userId);
    const prefs = (user?.preferences ?? {}) as { activeMailboxId?: unknown };
    const stored = typeof prefs.activeMailboxId === 'string' ? prefs.activeMailboxId : null;
    if (stored) {
      const owned = active.find((m) => m.id === stored);
      if (owned) {
        req.mailbox = { id: owned.id };
        return true;
      }
      // Preference points at a stale mailbox — fall through to the single-mailbox or picker branches.
    }

    if (active.length === 1) {
      req.mailbox = { id: active[0]!.id };
      return true;
    }

    throw new ConflictException({
      code: 'SELECT_MAILBOX',
      message:
        'Multiple mailboxes connected — select one via PATCH /api/mailboxes/:id/active or pass X-Active-Mailbox-Id.',
      mailboxes: active.map((m) => ({ id: m.id, email: m.email })),
    });
  }
}

/**
 * `@CurrentMailbox()` — param decorator returning `{ id }` for the
 * mailbox resolved by `CurrentMailboxGuard`. Routes that use this
 * decorator MUST also declare `@UseGuards(JwtGuard, CurrentMailboxGuard)`.
 */
export const CurrentMailbox = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { id: string } => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.mailbox) {
      throw new UnauthorizedException(
        'Route requires CurrentMailboxGuard before resolving @CurrentMailbox().',
      );
    }
    return req.mailbox;
  },
);
