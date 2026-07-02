import {
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { Capability } from '@declutrmail/shared/entitlements';

import type { SessionPrincipal } from '../../auth/sessions.service.js';
import { assertTierCapability, EntitlementsService } from './entitlements.service.js';

export const CAPABILITY_METADATA = 'declutrmail:capability';
export const CAPABILITY_EXEMPT_METADATA = 'declutrmail:capability-exempt';

/**
 * `@RequiresCapability('autopilot')` — declare that a route (or every
 * route on a controller) is gated on a D19 manifest capability. Pair
 * with `CapabilityGuard` in the `@UseGuards` list; under-tier
 * workspaces get the same 402 `PRO_FEATURE_REQUIRED` envelope the
 * Screener ships (D77 pattern, extracted).
 *
 * Prefer the CLASS-level form: it is default-closed — a route added to
 * the controller later is gated unless someone writes a loud
 * `@CapabilityExempt()` next to it.
 */
export function RequiresCapability(capability: Capability): MethodDecorator & ClassDecorator {
  return SetMetadata(CAPABILITY_METADATA, capability);
}

/**
 * `@CapabilityExempt()` — method-level opt-out from a class-level
 * `@RequiresCapability`. Every use MUST carry a comment explaining why
 * the route is safe for under-tier workspaces (e.g. a read the
 * pre-upgrade FE depends on).
 */
export function CapabilityExempt(): MethodDecorator {
  return SetMetadata(CAPABILITY_EXEMPT_METADATA, true);
}

/**
 * CapabilityGuard (D19/D77) — server-side Pro-feature enforcement.
 *
 * Resolves the caller's workspace tier (`workspaces.tier` via the
 * JwtGuard principal) and throws 402 `PRO_FEATURE_REQUIRED` when the
 * D19 manifest denies the route's declared capability — the exact gate
 * `ScreenerService.assertScreenerCapability` applies, packaged as a
 * guard so feature controllers can't forget it on new handlers.
 *
 * Must run AFTER `JwtGuard` in the guard list (it reads the principal
 * stamped on `req.user` — same contract as `InboxLimitGuard`). Routes
 * without capability metadata pass through untouched, so listing the
 * guard is always safe.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.get<boolean | undefined>(CAPABILITY_EXEMPT_METADATA, context.getHandler())) {
      return true;
    }
    // Handler metadata overrides class metadata (route-level gates on a
    // mixed controller, e.g. the quiet-hours PUT on MailboxesController).
    const capability = this.reflector.getAllAndOverride<Capability | undefined>(
      CAPABILITY_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!capability) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request & { user?: SessionPrincipal }>();
    if (!req.user) {
      // Defensive — only reachable if a route lists this guard without
      // JwtGuard before it.
      throw new UnauthorizedException('CapabilityGuard requires JwtGuard to run first.');
    }
    const tier = await this.entitlements.tierForWorkspace(req.user.workspaceId);
    assertTierCapability(tier, capability);
    return true;
  }
}
