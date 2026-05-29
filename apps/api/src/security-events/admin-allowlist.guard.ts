import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';

import { UsersService } from '../users/users.service.js';

/**
 * Founder-only allowlist guard for operator-facing routes (D181 read
 * surface). Triple-gated like {@link DevAuthController} so the route's
 * existence is never revealed to non-allowlisted users:
 *
 *   1. `req.user` populated (i.e. {@link JwtGuard} ran upstream)
 *   2. user row resolves from `userId`
 *   3. `users.email` ∈ `ADMIN_EMAIL_ALLOWLIST` (comma-separated env)
 *
 * Any miss → 404 (never 401, never 403). Matching {@link DevAuthController}'s
 * model: an authentication / authorization gate that LEAKS its
 * existence is itself an attack surface (lets an enumerator confirm
 * "this email is an admin" via timing or status-code differences).
 *
 * Allowlist source-of-truth is env, not DB — keeps the founder role
 * out-of-band of the application schema (no `users.is_admin` column,
 * no admin-role concept seeping into feature code). When the product
 * grows a real role concept, revisit.
 *
 * `ADMIN_EMAIL_ALLOWLIST` is OPTIONAL by design: unset → empty
 * allowlist → every request 404s. Mis-configuration fails CLOSED.
 */
@Injectable()
export class AdminAllowlistGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.user) {
      // JwtGuard should have run upstream. Defensive — never 200 a
      // route that lost its auth context.
      throw new NotFoundException();
    }
    const user = await this.users.findById(req.user.userId);
    if (!user || !isAllowlisted(user.email)) {
      throw new NotFoundException();
    }
    return true;
  }
}

/**
 * True iff `email` (case-insensitive) appears in the
 * `ADMIN_EMAIL_ALLOWLIST` env, treated as a comma-separated list of
 * exact email matches. Unset / empty → no email is allowlisted.
 *
 * Exact match (not prefix) so a typo in the env can never silently
 * widen the allowlist. Case-insensitive because email comparison is
 * RFC-5321 local-part SHOULD-be case-sensitive but real providers
 * (incl. Gmail) ignore case — matching the real-world behavior
 * avoids surprise lockouts.
 */
export function isAllowlisted(email: string): boolean {
  const raw = process.env.ADMIN_EMAIL_ALLOWLIST;
  if (!raw || raw.trim().length === 0) {
    return false;
  }
  const target = email.trim().toLowerCase();
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .includes(target);
}
