import {
  Controller,
  Get,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { ok, type Envelope, type SyncReadiness } from '@declutrmail/shared/contracts';
import type { TierId } from '@declutrmail/shared/entitlements';

import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { RateLimit } from '../common/rate-limit/index.js';
import {
  MailboxAccountsService,
  type MailboxSummary,
} from '../mailboxes/mailbox-accounts.service.js';
import { SyncService } from '../sync/sync.service.js';
import { UsersService } from '../users/users.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { CsrfService } from './csrf.service.js';
import { CurrentUser, JwtGuard, REFRESH_COOKIE } from './jwt.guard.js';
import { JwtService } from './jwt.service.js';
import { SessionsService, type SessionPrincipal } from './sessions.service.js';
import { clearSessionCookies, setSessionCookies } from './session-cookies.js';

/**
 * A mailbox summary plus its initial-sync readiness (D116). Readiness is
 * composed here from the sync feature's facade (`SyncService`) rather
 * than joined into the mailboxes query, keeping `provider_sync_state`
 * owned by the sync module (D204).
 */
export interface MailboxView extends MailboxSummary {
  readiness: SyncReadiness | null;
}

/** Wire shape for GET /api/auth/me — drives the FE AuthProvider. */
export interface MeEnvelope {
  user: { id: string; email: string; workspaceId: string };
  mailboxes: MailboxView[];
  activeMailboxId: string | null;
  /** Workspace billing tier (D19) — drives every FE entitlement gate. */
  tier: TierId;
  /**
   * Free-tier lifetime cleanup actions left (D19: 5 lifetime);
   * `null` = unlimited (every paid tier). Mirrored by the FE
   * `useTier()` hook; the manifest resolvers in
   * `@declutrmail/shared/entitlements` carry the limits themselves.
   */
  cleanupRemaining: number | null;
}

/**
 * AuthController (D155, D205).
 *
 *   GET  /api/auth/me       — JwtGuard; returns user + mailboxes
 *   POST /api/auth/logout   — Jwt + CsrfGuard; revokes session, clears cookies
 *   POST /api/auth/refresh  — reads refresh cookie, rotates, sets cookies
 *
 * Routes for the OAuth flow live in `GoogleOAuthController`; the
 * controller here owns the post-login session API.
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly sessions: SessionsService,
    private readonly jwt: JwtService,
    private readonly csrf: CsrfService,
    private readonly users: UsersService,
    private readonly mailboxes: MailboxAccountsService,
    private readonly sync: SyncService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get('me')
  @UseGuards(JwtGuard)
  async me(@CurrentUser() principal: SessionPrincipal): Promise<Envelope<MeEnvelope>> {
    const [user, mailboxes] = await Promise.all([
      this.users.findById(principal.userId),
      this.mailboxes.listByWorkspace(principal.workspaceId),
    ]);
    if (!user) {
      throw new UnauthorizedException('User no longer exists.');
    }
    const prefs = (user.preferences ?? {}) as { activeMailboxId?: unknown };
    const stored = typeof prefs.activeMailboxId === 'string' ? prefs.activeMailboxId : null;
    const activeMailboxId =
      stored && mailboxes.some((m) => m.id === stored && m.status === 'active')
        ? stored
        : (mailboxes.find((m) => m.status === 'active')?.id ?? null);
    // Compose per-mailbox sync readiness via the sync facade (D116, D204).
    // The tier + free-cap position ride the same response (D19/D77) —
    // `cleanupSummary` skips the count scan entirely for paid tiers.
    const [readiness, quota] = await Promise.all([
      this.sync.getReadinessByMailbox(mailboxes.map((m) => m.id)),
      this.entitlements.cleanupSummary(principal.workspaceId),
    ]);
    const mailboxViews: MailboxView[] = mailboxes.map((m) => ({
      ...m,
      readiness: readiness.get(m.id) ?? null,
    }));
    return ok({
      user: { id: user.id, email: user.email, workspaceId: user.workspaceId },
      mailboxes: mailboxViews,
      activeMailboxId,
      tier: quota.tier,
      cleanupRemaining: quota.remaining,
    });
  }

  @Post('logout')
  @UseGuards(JwtGuard, CsrfGuard)
  async logout(
    @CurrentUser() principal: SessionPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Envelope<{ ok: true }>> {
    await this.sessions.revoke(principal.sessionId);
    clearSessionCookies(res);
    return ok({ ok: true });
  }

  /**
   * Refresh the session.
   *
   * Reads the refresh JWT from `dm_refresh`, verifies it, then asks
   * the SessionsService to rotate (which checks the row exists, the
   * hash matches, and issues a new pair). Sets fresh cookies + a new
   * CSRF token.
   *
   * NO CsrfGuard here — the refresh cookie is SameSite=Strict so it
   * cannot be sent cross-site at all; an attacker page literally
   * cannot trigger this endpoint with the user's refresh.
   */
  @Post('refresh')
  @RateLimit('auth')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Envelope<{ ok: true }>> {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const refreshCookie = cookies?.[REFRESH_COOKIE];
    if (typeof refreshCookie !== 'string') {
      throw new UnauthorizedException('Missing refresh cookie.');
    }
    let claims;
    try {
      claims = await this.jwt.verify(refreshCookie, 'refresh');
    } catch (err) {
      this.logger.debug(`refresh verify failed: ${err instanceof Error ? err.message : err}`);
      throw new UnauthorizedException('Invalid refresh token.');
    }
    try {
      const tokens = await this.sessions.rotate({
        sessionId: claims.sid,
        presentedRefreshToken: refreshCookie,
      });
      setSessionCookies(res, tokens, this.csrf.issue());
      return ok({ ok: true });
    } catch (err) {
      this.logger.warn(`refresh rotate failed: ${err instanceof Error ? err.message : err}`);
      clearSessionCookies(res);
      throw new UnauthorizedException('Refresh denied.');
    }
  }
}
