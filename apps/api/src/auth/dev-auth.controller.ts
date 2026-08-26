import {
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';

import { workspaces } from '@declutrmail/db';
import { TIER_IDS, type TierId } from '@declutrmail/shared/entitlements';

import { RateLimit } from '../common/rate-limit/index.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { UsersService } from '../users/users.service.js';
import { CsrfService } from './csrf.service.js';
import { CurrentUser, JwtGuard } from './jwt.guard.js';
import type { SessionPrincipal } from './sessions.service.js';
import { SessionsService } from './sessions.service.js';
import { setSessionCookies } from './session-cookies.js';

/**
 * DEV-ONLY test login (D206 — smoke/e2e auth fixture).
 *
 * Issues a real session for an EXISTING user WITHOUT the Google OAuth
 * round-trip, so the preview browser / Playwright can reach the
 * authenticated app and exercise full flows (connect, disconnect,
 * switch, no-active, sync gate). It never creates a user and never
 * mints or touches OAuth tokens — it only calls `SessionsService.issue`
 * for an account that already exists.
 *
 * ⚠️ SECURITY: this is an authentication bypass. It is triple-gated and
 * MUST be unreachable in production:
 *   1. `NODE_ENV !== 'production'` (hard — prod is always 404).
 *   2. `DEV_AUTH_ENABLED === 'true'` (explicit opt-in; unset by default).
 *   3. the email matches `DEV_AUTH_EMAIL_PREFIX` (unset → NO email allowed).
 * Any miss → 404 (never reveal the route exists). `main.ts` additionally
 * refuses to boot if the prod + enabled combination is ever configured.
 */

/** True only when the dev login is explicitly enabled in a non-prod env. */
export function devAuthEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH_ENABLED === 'true';
}

/** Email allowlist — must match the configured prefix. Unset prefix → none. */
export function devAuthEmailAllowed(email: string): boolean {
  const prefix = process.env.DEV_AUTH_EMAIL_PREFIX;
  return typeof prefix === 'string' && prefix.length > 0 && email.startsWith(prefix);
}

@Controller('auth/dev')
export class DevAuthController {
  private readonly logger = new Logger(DevAuthController.name);

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly csrf: CsrfService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  /**
   * `GET /api/auth/dev/login?email=<allowlisted>` — issue a session and
   * redirect to the app. GET (not POST) so the preview can navigate to
   * it directly; acceptable because the route is dev-only, allowlisted,
   * and creates no state beyond a session for a known test account.
   */
  @Get('login')
  @RateLimit('auth')
  async login(
    @Query('email') email: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Triple gate — any miss is an indistinguishable 404.
    if (!devAuthEnabled()) throw new NotFoundException();
    if (!email || !devAuthEmailAllowed(email)) throw new NotFoundException();

    const user = await this.users.findByEmail(email);
    if (!user) throw new NotFoundException();

    const ipAddress = (req.ip ?? null) as string | null;
    const userAgent = (req.headers['user-agent'] ?? null) as string | null;
    const { tokens } = await this.sessions.issue({
      userId: user.userId,
      workspaceId: user.workspaceId,
      ipAddress,
      userAgent,
    });
    setSessionCookies(res, tokens, this.csrf.issue());
    this.logger.warn(`DEV login issued for ${email} (NODE_ENV=${process.env.NODE_ENV ?? 'unset'})`);

    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    res.redirect(302, `${webBase}/senders`);
  }

  /**
   * `GET /api/auth/dev/tier?tier=pro&next=/brief` — DEV-ONLY tier switch.
   *
   * Sets `workspaces.tier` for the SESSION'S OWN workspace so Free / Plus
   * / Pro surfaces can be walked by hand without a checkout. It writes the
   * same column billing writes, and nothing caches tier (`CapabilityGuard`
   * reads it live per request), so both sides move together: the FE gates
   * off the next `/api/auth/me`, and the BE 402s on the next request.
   *
   * WHAT IT DOES NOT DO — and this is the point. It creates NO
   * subscription row. That is deliberate: faking one would make
   * `/billing` describe money that never moved, which is the exact
   * "fake billing state" CLAUDE.md §10 forbids. So a dev-switched
   * workspace looks like an entitled workspace with no backing
   * subscription — a real state the product already models (see the
   * non-backing notice on `/billing`), not an invented one. Cancel,
   * refund and invoice flows still need a real sandbox checkout.
   *
   * ⚠️ SECURITY: same posture as the dev login above — an entitlement
   * bypass, double-gated and unreachable in production:
   *   1. `devAuthEnabled()` — prod is always 404, and the opt-in is unset
   *      by default.
   *   2. `JwtGuard` — acts only on the caller's OWN workspace, never on
   *      one named in the query string.
   * A GET (so it is reachable from the address bar) for the same reason
   * the dev login is one: dev-only, self-scoped, and 404 otherwise.
   */
  @Get('tier')
  @UseGuards(JwtGuard)
  @RateLimit('auth')
  async setTier(
    @CurrentUser() user: SessionPrincipal,
    @Query('tier') tier: string | undefined,
    @Query('next') next: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!devAuthEnabled()) throw new NotFoundException();
    if (!isTierId(tier)) throw new NotFoundException();

    await this.db.update(workspaces).set({ tier }).where(eq(workspaces.id, user.workspaceId));
    this.logger.warn(
      `DEV tier set to ${tier} for workspace ${user.workspaceId} (NODE_ENV=${process.env.NODE_ENV ?? 'unset'})`,
    );

    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    res.redirect(302, `${webBase}${safeNextPath(next)}`);
  }
}

/** Narrow an arbitrary query value to a manifest tier id. */
function isTierId(candidate: string | undefined): candidate is TierId {
  return typeof candidate === 'string' && (TIER_IDS as readonly string[]).includes(candidate);
}

/**
 * Where to land after the switch. Only a same-origin ABSOLUTE PATH is
 * honoured: a leading `//` or `/\` is a protocol-relative URL that would
 * send the browser to another host, so anything but a single leading
 * slash falls back to Settings.
 */
function safeNextPath(next: string | undefined): string {
  if (typeof next !== 'string') return '/settings';
  if (!next.startsWith('/')) return '/settings';
  if (next.startsWith('//') || next.startsWith('/\\')) return '/settings';
  return next;
}
