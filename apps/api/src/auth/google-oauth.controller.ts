import { randomBytes, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';

import {
  BETA_DENIED_PATH,
  BETA_DENIED_REASON,
  BETA_DENIED_REASON_PARAM,
} from '@declutrmail/shared/contracts';

import { InboxLimitGuard } from '../common/entitlements/inbox-limit.guard.js';
import { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { SecurityEventsService } from '../security-events/security-events.service.js';
import { AuthSignupOrchestrator } from './auth-signup.orchestrator.js';
import { BetaGateDeniedError } from './beta-gate.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { JwtService } from './jwt.service.js';
import { CurrentUser, JwtGuard } from './jwt.guard.js';
import { SessionsService, type SessionPrincipal } from './sessions.service.js';
import { setSessionCookies } from './session-cookies.js';

/** Cookie carrying the OAuth state — nonce + post-callback intent. */
const STATE_COOKIE = 'oauth_state';
/** Cookie path — scoped to the connect routes only. */
const STATE_COOKIE_PATH = '/api/auth/google';
/** Signed state and browser cookie share the same bounded consent window. */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * What the state cookie carries between /start and /callback.
 *
 *   - `mode: 'login'`   — unauthenticated flow. Callback finds or
 *     creates the user/workspace and issues fresh session cookies.
 *   - `mode: 'connect'` — authenticated flow. Callback adds the Google
 *     account to the CURRENT user's workspace without creating a new
 *     user and without re-issuing cookies. `userId` + `workspaceId`
 *     are captured at /start time when the JwtGuard ran.
 */
interface OAuthStateBase {
  nonce: string;
  /** Signed issuance time lets the callback prove the lifetime was never extended. */
  issuedAt: number;
  /** Absolute signed expiry, independently enforced from browser cookie eviction. */
  expiresAt: number;
}

interface LoginOAuthState extends OAuthStateBase {
  mode: 'login';
  /** Canonical local billing destination; login mode only. */
  returnTo?: string | undefined;
}

interface ConnectOAuthState extends OAuthStateBase {
  mode: 'connect';
  userId: string;
  workspaceId: string;
  /** Stable active_sessions.id captured from the guarded originating request. */
  sessionId: string;
  /**
   * Owned active mailbox explicitly being re-authorized. Its identity is
   * revalidated after Google returns so the account chooser cannot silently
   * refresh a different mailbox.
   */
  reconnectMailboxId?: string | undefined;
}

type OAuthState = LoginOAuthState | ConnectOAuthState;
type ReconnectResult = 'account_mismatch' | 'cancelled' | 'failed' | 'target_invalid';
type PendingOAuthState =
  | Omit<LoginOAuthState, 'issuedAt' | 'expiresAt'>
  | Omit<ConnectOAuthState, 'issuedAt' | 'expiresAt'>;

const boundedString = z.string().min(1).max(256);
const uuidSchema = z.string().uuid();
const oauthStateSchema = z.discriminatedUnion('mode', [
  z
    .object({
      nonce: boundedString,
      issuedAt: z.number().int().positive(),
      expiresAt: z.number().int().positive(),
      mode: z.literal('login'),
      returnTo: z.string().max(512).optional(),
    })
    .strict(),
  z
    .object({
      nonce: boundedString,
      issuedAt: z.number().int().positive(),
      expiresAt: z.number().int().positive(),
      mode: z.literal('connect'),
      userId: uuidSchema,
      workspaceId: uuidSchema,
      sessionId: uuidSchema,
      reconnectMailboxId: uuidSchema.optional(),
    })
    .strict(),
]);

/**
 * Gmail OAuth connect routes (D4, D205).
 *
 *   GET /api/auth/google/start
 *     Unauthenticated. Begins signup / login. Callback issues session.
 *
 *   GET /api/auth/google/connect-mailbox/start
 *     Authenticated (JwtGuard). Begins "add another Gmail account to
 *     this workspace" flow. Callback ONLY upserts the mailbox; no new
 *     session is issued.
 *
 *   GET /api/auth/google/callback
 *     Single Google redirect target. Reads the state cookie's `mode`
 *     to branch between the two flows above.
 *
 * Thin per D201/D204 — each handler delegates to the orchestrator.
 */
@Controller('auth/google')
export class GoogleOAuthController {
  private readonly logger = new Logger(GoogleOAuthController.name);

  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly orchestrator: AuthSignupOrchestrator,
    private readonly securityEvents: SecurityEventsService,
    private readonly mailboxes: MailboxAccountsService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
  ) {}

  @Get('start')
  @RateLimit('auth')
  start(@Res() res: Response, @Query('returnTo') returnTo?: unknown): void {
    const safeReturnTo = parseBillingReturnTo(returnTo);
    this.beginConsent(res, {
      nonce: randomBytes(32).toString('base64url'),
      mode: 'login',
      ...(safeReturnTo ? { returnTo: safeReturnTo } : {}),
    });
  }

  /**
   * Authenticated start: adds another Gmail account to the current
   * workspace. The state cookie carries `userId` + `workspaceId` so
   * the callback can verify the same browser still owns the session
   * AND knows which workspace to add the new mailbox to.
   *
   * `InboxLimitGuard` (D19/D81) gates a normal add BEFORE the Google
   * consent screen. A non-empty `reconnectMailboxId` only defers that
   * fast-fail to this handler: the target must be a syntactically valid,
   * owned active mailbox before consent begins. The callback binds Google’s
   * returned identity to the same target, while `addMailbox` remains the
   * canonical activation-boundary limit check.
   */
  @Get('connect-mailbox/start')
  @RateLimit('auth')
  @UseGuards(JwtGuard, InboxLimitGuard)
  async connectMailboxStart(
    @CurrentUser() user: SessionPrincipal,
    @Res() res: Response,
    @Query('reconnectMailboxId') reconnectMailboxId?: unknown,
  ): Promise<void> {
    let validatedReconnectId: string | undefined;
    if (reconnectMailboxId !== undefined) {
      if (typeof reconnectMailboxId !== 'string' || !isUuid(reconnectMailboxId)) {
        throw new BadRequestException('Reconnect target must be a valid mailbox id.');
      }
      const target = await this.findReconnectTarget(
        user.userId,
        user.workspaceId,
        reconnectMailboxId,
      );
      if (!target) {
        // One response for missing, cross-user, and disconnected targets:
        // do not leak whether a caller-supplied mailbox id exists.
        throw new BadRequestException('Reconnect target is unavailable.');
      }
      validatedReconnectId = target.id;
    }

    this.beginConsent(res, {
      nonce: randomBytes(32).toString('base64url'),
      mode: 'connect',
      userId: user.userId,
      workspaceId: user.workspaceId,
      sessionId: user.sessionId,
      ...(validatedReconnectId ? { reconnectMailboxId: validatedReconnectId } : {}),
    });
  }

  @Get('callback')
  @RateLimit('auth')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: unknown,
    @Query('state') state?: unknown,
    @Query('error') oauthError?: unknown,
  ): Promise<void> {
    // Request metadata shared by every D181 emit in this handler. Captured
    // up-front because the failure emits below run before any per-flow
    // (login vs connect) branching.
    const ipAddress = req.ip ?? null;
    const userAgentHeader = req.headers['user-agent'];
    const userAgent = typeof userAgentHeader === 'string' ? userAgentHeader : null;

    const cookieRaw = (req.cookies as Record<string, unknown> | undefined)?.[STATE_COOKIE];
    if (typeof cookieRaw !== 'string') {
      // D181: pre-orchestrator validation failure — no user/workspace
      // context yet, so the audit row is identified by ip/UA only.
      void this.securityEvents.record({
        eventType: 'login.failure',
        severity: 'warning',
        sourceIp: ipAddress,
        userAgent,
        payload: { provider: 'google', reason: 'missing_state_cookie' },
      });
      this.clearStateCookie(res);
      throw new BadRequestException('Missing OAuth state cookie.');
    }
    const cookieState = this.readStateCookie(cookieRaw);
    if (!cookieState) {
      void this.securityEvents.record({
        eventType: 'login.failure',
        severity: 'warning',
        sourceIp: ipAddress,
        userAgent,
        payload: { provider: 'google', reason: 'invalid_state_cookie' },
      });
      this.clearStateCookie(res);
      throw new BadRequestException('Invalid OAuth state cookie.');
    }
    if (typeof state !== 'string' || !statesMatch(state, cookieState.nonce)) {
      void this.securityEvents.record({
        eventType: 'login.failure',
        severity: 'warning',
        sourceIp: ipAddress,
        userAgent,
        payload: { provider: 'google', reason: 'invalid_state' },
      });
      this.clearStateCookie(res);
      throw new BadRequestException('Invalid OAuth state.');
    }
    const reconnectState = isTargetedReconnectState(cookieState) ? cookieState : null;
    const reconnectMailboxId = reconnectState?.reconnectMailboxId;

    if (reconnectState) {
      // Rebind the signed authority to the stable originating session before
      // accepting either a Google success or cancellation. Refresh rotation
      // may change jti, but logout or an administrator revoke makes this
      // lookup fail immediately.
      await this.assertConnectSessionActive(reconnectState, res, ipAddress, userAgent);
    }

    const webBase = process.env.WEB_URL ?? 'http://localhost:3000';
    if (reconnectState && oauthError !== undefined) {
      // Google documents `access_denied` for user cancellation. Treat every
      // other shape/value as one closed failure result: arrays and future or
      // attacker-controlled strings never reach a URL, audit payload, or log.
      const cancelled = typeof oauthError === 'string' && oauthError === 'access_denied';
      this.recordReconnectFailure({
        reason: cancelled ? 'reconnect_cancelled' : 'reconnect_failed',
        userId: reconnectState.userId,
        workspaceId: reconnectState.workspaceId,
        sourceIp: ipAddress,
        userAgent,
      });
      this.redirectReconnectResult(
        res,
        webBase,
        reconnectState.reconnectMailboxId,
        cancelled ? 'cancelled' : 'failed',
      );
      return;
    }

    if (typeof code !== 'string' || code.length === 0) {
      if (reconnectState) {
        this.recordReconnectFailure({
          reason: 'reconnect_failed',
          userId: reconnectState.userId,
          workspaceId: reconnectState.workspaceId,
          sourceIp: ipAddress,
          userAgent,
        });
        this.redirectReconnectResult(res, webBase, reconnectState.reconnectMailboxId, 'failed');
        return;
      }
      void this.securityEvents.record({
        eventType: 'login.failure',
        severity: 'warning',
        sourceIp: ipAddress,
        userAgent,
        payload: { provider: 'google', reason: 'missing_code' },
      });
      this.clearStateCookie(res);
      throw new BadRequestException('Missing OAuth `code` query parameter.');
    }

    if (cookieState.mode === 'connect' && !reconnectState) {
      // Keep the original add-mailbox validation order: malformed callbacks
      // fail before the originating-session read, while valid callbacks bind
      // the signed authority before consuming Google's code.
      await this.assertConnectSessionActive(cookieState, res, ipAddress, userAgent);
    }

    let email: string;
    let refreshToken: string;
    try {
      ({ email, refreshToken } = await this.oauth.exchangeCode(code));
    } catch (err) {
      // Google rejected the exchange — wrong/expired code, mis-configured
      // OAuth client, or no refresh_token (already-consented account).
      // Reason is a closed enum; the underlying error message is never
      // copied into the payload (it can carry Google response detail).
      if (reconnectState) {
        this.recordReconnectFailure({
          reason: 'reconnect_failed',
          userId: reconnectState.userId,
          workspaceId: reconnectState.workspaceId,
          sourceIp: ipAddress,
          userAgent,
        });
        this.redirectReconnectResult(res, webBase, reconnectState.reconnectMailboxId, 'failed');
        return;
      }
      void this.securityEvents.record({
        eventType: 'login.failure',
        severity: 'warning',
        sourceIp: ipAddress,
        userAgent,
        payload: { provider: 'google', reason: 'token_exchange_failed' },
      });
      throw err;
    }
    if (!reconnectState) {
      // Preserve login and normal add-mailbox state-consumption timing.
      this.clearStateCookie(res);
    }

    if (cookieState.mode === 'connect') {
      let connectEmail = email;
      if (reconnectMailboxId !== undefined) {
        let reconnectTarget: { id: string; email: string } | null;
        try {
          reconnectTarget = await this.findReconnectTarget(
            cookieState.userId,
            cookieState.workspaceId,
            reconnectMailboxId,
          );
        } catch {
          this.recordReconnectFailure({
            reason: 'reconnect_failed',
            userId: cookieState.userId,
            workspaceId: cookieState.workspaceId,
            sourceIp: ipAddress,
            userAgent,
          });
          this.redirectReconnectResult(res, webBase, reconnectMailboxId, 'failed');
          return;
        }
        if (!reconnectTarget) {
          this.recordReconnectFailure({
            reason: 'reconnect_target_invalid',
            userId: cookieState.userId,
            workspaceId: cookieState.workspaceId,
            sourceIp: ipAddress,
            userAgent,
          });
          this.redirectReconnectResult(res, webBase, reconnectMailboxId, 'target_invalid');
          return;
        }
        if (normalizeEmail(email) !== normalizeEmail(reconnectTarget.email)) {
          this.recordReconnectFailure({
            reason: 'reconnect_account_mismatch',
            userId: cookieState.userId,
            workspaceId: cookieState.workspaceId,
            sourceIp: ipAddress,
            userAgent,
          });
          this.redirectReconnectResult(res, webBase, reconnectMailboxId, 'account_mismatch');
          return;
        }
        // Use the already-persisted canonical identity so a harmless case or
        // whitespace difference in Google's claim cannot look like a new
        // mailbox at the activation-boundary lookup.
        connectEmail = reconnectTarget.email;
      }

      // Close most of the Google-exchange revocation window. A transaction
      // cannot span an external OAuth call; this second live read makes the
      // remaining TOCTOU only the immediate service-call boundary.
      await this.assertConnectSessionActive(cookieState, res, ipAddress, userAgent);
      // State consumed — clear before the mutation so neither a successful
      // reconnect nor an orchestrator failure can replay the Google code.
      if (reconnectState) this.clearStateCookie(res);

      try {
        const { mailboxId } = await this.orchestrator.addMailbox({
          currentUserId: cookieState.userId,
          currentWorkspaceId: cookieState.workspaceId,
          email: connectEmail,
          refreshToken,
        });
        // D181 success emit — connect-mode adds a mailbox to an existing
        // session, so userId/workspaceId come from the verified cookie.
        void this.securityEvents.record({
          eventType: 'login.success',
          severity: 'info',
          userId: cookieState.userId,
          workspaceId: cookieState.workspaceId,
          sourceIp: ipAddress,
          userAgent,
          payload: { provider: 'google', mode: 'connect' },
        });
        // Route the freshly-connected mailbox through the sync gate
        // (D6 strict-gate-everywhere, D109) instead of dumping the user
        // on an empty /triage. addMailbox set it active, so the gate
        // resolves it via CurrentMailboxGuard; the `mailbox` param lets
        // the gate poll THIS mailbox explicitly even if the user later
        // switches back to their primary (D116 escape hatch).
        const query = new URLSearchParams({
          mailbox: mailboxId,
          ...(reconnectState ? { reconnect: '1' } : {}),
        });
        res.redirect(302, `${webBase}/onboarding?${query.toString()}`);
      } catch (err) {
        // Cross-workspace ownership refusal — bounce back with a flag
        // the FE can read into a toast.
        if (reconnectState) {
          // Do not leak the Google identity or an upstream/DB error message.
          this.logger.warn('Targeted Gmail reconnect failed.');
          this.recordReconnectFailure({
            reason: 'reconnect_failed',
            userId: cookieState.userId,
            workspaceId: cookieState.workspaceId,
            sourceIp: ipAddress,
            userAgent,
          });
          this.redirectReconnectResult(res, webBase, reconnectState.reconnectMailboxId, 'failed');
          return;
        }
        const message =
          err instanceof Error ? err.message : 'Failed to connect the additional mailbox.';
        this.logger.warn(`connect-mailbox failed for ${email}: ${message}`);
        const code =
          typeof (err as { response?: { code?: string } }).response?.code === 'string'
            ? (err as { response: { code: string } }).response.code
            : 'connect_failed';
        // D181 emit — the only payload field we trust is the controlled
        // `code` string extracted from the orchestrator's structured
        // error response (a closed `ErrorCode` enum); never the raw
        // `err.message`, which could carry caller-controlled data.
        void this.securityEvents.record({
          eventType: 'login.failure',
          severity: 'warning',
          userId: cookieState.userId,
          workspaceId: cookieState.workspaceId,
          sourceIp: ipAddress,
          userAgent,
          payload: { provider: 'google', mode: 'connect', reason: code },
        });
        res.redirect(302, `${webBase}/triage?connect_error=${encodeURIComponent(code)}`);
      }
      return;
    }

    // Unauthenticated login / signup flow.
    let result: Awaited<ReturnType<AuthSignupOrchestrator['connect']>>;
    try {
      result = await this.orchestrator.connect({
        email,
        refreshToken,
        ipAddress,
        userAgent,
      });
    } catch (err) {
      if (err instanceof BetaGateDeniedError) {
        // Private-beta invite gate (F7) — a brand-new signup without
        // an invite. Not a failure of the OAuth machinery: severity
        // info, and the user gets the public /beta waitlist page, not
        // an error. The denied email IS included in the audit payload
        // — it's the operational signal the founder acts on (add to
        // BETA_INVITE_EMAILS), it's a verified Google id_token claim
        // (not caller-controlled free text), and security_events is
        // the founder-only D181 surface — NOT telemetry, where raw
        // emails are banned (D159).
        void this.securityEvents.record({
          eventType: 'signup.denied',
          severity: 'info',
          sourceIp: ipAddress,
          userAgent,
          payload: { provider: 'google', reason: 'beta_gate_denied', email },
        });
        res.redirect(
          302,
          `${webBase}${BETA_DENIED_PATH}?${BETA_DENIED_REASON_PARAM}=${BETA_DENIED_REASON}`,
        );
        return;
      }
      // D181 emit — the orchestrator itself failed (DB outage during
      // user/workspace bootstrap, KMS unavailable, sync enqueue race
      // recovery exhausted, …). No verified userId/workspaceId to
      // attach; the reason enum is fixed.
      void this.securityEvents.record({
        eventType: 'login.failure',
        severity: 'warning',
        sourceIp: ipAddress,
        userAgent,
        payload: { provider: 'google', reason: 'orchestrator_failed' },
      });
      throw err;
    }
    setSessionCookies(res, result.tokens, result.csrfToken);
    // D181 emit — the orchestrator resolved the user; the audit row can
    // carry the verified userId/workspaceId and whether this was a new
    // signup vs returning user (a useful operator filter).
    void this.securityEvents.record({
      eventType: 'login.success',
      severity: 'info',
      userId: result.user.id,
      workspaceId: result.user.workspaceId,
      sourceIp: ipAddress,
      userAgent,
      payload: {
        provider: 'google',
        mode: 'login',
        isNewSignup: result.isNewSignup,
      },
    });
    // New signups land on the onboarding sync gate (D6, D109) — it
    // polls real sync state and auto-advances to /senders once
    // readiness = ready. Returning users skip straight to /senders
    // (their sync is already done). Senders is the post-onboarding
    // home: it has real data immediately, whereas Triage is empty
    // until the scoring pipeline (D20/D25) runs. The gate route lives
    // at apps/web/src/app/onboarding/page.tsx.
    // Re-validate the cookie value at the trust boundary even though
    // `/start` canonicalized it. This keeps a forged/dev cookie from
    // becoming an open redirect after a successful Google login.
    const returnTo = parseBillingReturnTo(cookieState.returnTo);
    const target = result.isNewSignup
      ? returnTo
        ? `${webBase}/onboarding?${new URLSearchParams({ returnTo }).toString()}`
        : `${webBase}/onboarding`
      : returnTo
        ? `${webBase}${returnTo}`
        : `${webBase}/senders`;
    res.redirect(302, target);
  }

  /**
   * Write the state cookie + redirect to Google consent. Shared by
   * both `start` paths.
   */
  private beginConsent(res: Response, pendingState: PendingOAuthState): void {
    const issuedAt = Date.now();
    const state: OAuthState = {
      ...pendingState,
      issuedAt,
      expiresAt: issuedAt + STATE_TTL_MS,
    };
    res.cookie(STATE_COOKIE, this.jwt.sealOAuthState(JSON.stringify(state)), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: STATE_COOKIE_PATH,
      maxAge: STATE_TTL_MS,
    });
    res.redirect(302, this.oauth.getConsentUrl(state.nonce));
  }

  /** Authenticate, strictly decode, and enforce the cookie's signed expiry. */
  private readStateCookie(cookie: string): OAuthState | null {
    const payload = this.jwt.openOAuthState(cookie);
    if (!payload) return null;

    let decoded: unknown;
    try {
      decoded = JSON.parse(payload);
    } catch {
      return null;
    }
    const parsed = oauthStateSchema.safeParse(decoded);
    if (!parsed.success) return null;

    const now = Date.now();
    const signedLifetime = parsed.data.expiresAt - parsed.data.issuedAt;
    if (
      parsed.data.expiresAt <= now ||
      signedLifetime <= 0 ||
      signedLifetime > STATE_TTL_MS ||
      parsed.data.issuedAt > now + 60_000
    ) {
      return null;
    }
    return parsed.data;
  }

  private async assertConnectSessionActive(
    state: ConnectOAuthState,
    res: Response,
    sourceIp: string | null,
    userAgent: string | null,
  ): Promise<void> {
    const originSession = await this.sessions.lookupActiveById(state.sessionId);
    if (
      originSession &&
      originSession.userId === state.userId &&
      originSession.workspaceId === state.workspaceId
    ) {
      return;
    }

    void this.securityEvents.record({
      eventType: 'login.failure',
      severity: 'warning',
      userId: state.userId,
      workspaceId: state.workspaceId,
      sourceIp,
      userAgent,
      payload: { provider: 'google', mode: 'connect', reason: 'connect_session_invalid' },
    });
    this.clearStateCookie(res);
    throw new UnauthorizedException('Connect-mailbox session is no longer active.');
  }

  private clearStateCookie(res: Response): void {
    res.clearCookie(STATE_COOKIE, { path: STATE_COOKIE_PATH });
  }

  /** Fixed, local Settings destination for a signed targeted reconnect. */
  private redirectReconnectResult(
    res: Response,
    webBase: string,
    mailboxId: string,
    result: ReconnectResult,
  ): void {
    this.clearStateCookie(res);
    const query = new URLSearchParams({ reconnect_result: result });
    res.redirect(
      302,
      `${webBase}/settings?${query.toString()}#mailbox-${encodeURIComponent(mailboxId)}`,
    );
  }

  /** Resolve an active mailbox owned by both the state user and workspace. */
  private async findReconnectTarget(
    userId: string,
    workspaceId: string,
    mailboxId: unknown,
  ): Promise<{ id: string; email: string } | null> {
    if (typeof mailboxId !== 'string' || !isUuid(mailboxId)) return null;
    const row = await this.mailboxes.findOwned(workspaceId, mailboxId);
    if (!row || row.userId !== userId || row.status !== 'active') return null;
    return { id: row.id, email: row.providerAccountId };
  }

  /** Privacy-safe audit: controlled reason only; no mailbox id or email. */
  private recordReconnectFailure(input: {
    reason:
      | 'reconnect_account_mismatch'
      | 'reconnect_cancelled'
      | 'reconnect_failed'
      | 'reconnect_target_invalid';
    userId: string;
    workspaceId: string;
    sourceIp: string | null;
    userAgent: string | null;
  }): void {
    void this.securityEvents.record({
      eventType: 'login.failure',
      severity: 'warning',
      userId: input.userId,
      workspaceId: input.workspaceId,
      sourceIp: input.sourceIp,
      userAgent: input.userAgent,
      payload: { provider: 'google', mode: 'connect', reason: input.reason },
    });
  }
}

/** UUID shape accepted by Postgres' uuid type; reject malformed hints pre-DB. */
function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

/** Preserve the schema-proven reconnect id while narrowing the state union. */
function isTargetedReconnectState(
  state: OAuthState,
): state is ConnectOAuthState & { reconnectMailboxId: string } {
  return state.mode === 'connect' && state.reconnectMailboxId !== undefined;
}

/** Google identity comparison only; stored canonical email wins on mutation. */
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Accept the single public-to-product destination supported at launch.
 * The returned path is canonical so OAuth state never carries arbitrary
 * hosts, fragments, duplicate parameters, or future unreviewed routes.
 */
export function parseBillingReturnTo(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('#')
  ) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value, 'https://declutrmail.invalid');
  } catch {
    return undefined;
  }
  if (url.origin !== 'https://declutrmail.invalid' || url.pathname !== '/billing') {
    return undefined;
  }

  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !['plan', 'cycle', 'promo'].includes(key))) return undefined;
  if (new Set(keys).size !== keys.length) return undefined;

  const plan = url.searchParams.get('plan');
  const cycle = url.searchParams.get('cycle');
  const promo = url.searchParams.get('promo');
  if ((plan !== 'plus' && plan !== 'pro') || (cycle !== 'monthly' && cycle !== 'annual')) {
    return undefined;
  }
  if (promo !== null && promo !== 'foundingPro') return undefined;
  if (promo === 'foundingPro' && (plan !== 'pro' || cycle !== 'annual')) return undefined;

  const query = new URLSearchParams({ plan, cycle });
  if (promo === 'foundingPro') query.set('promo', promo);
  return `/billing?${query.toString()}`;
}

/** Constant-time state comparison — same shape as the original. */
function statesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
