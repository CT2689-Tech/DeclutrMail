import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/**
 * D155 — JWT cookie auth.
 *
 *   - access token: 15-min lifetime, HttpOnly `Secure` `SameSite=Lax` cookie
 *   - refresh token: 30-day lifetime, rotating, HttpOnly `Secure` `SameSite=Strict` cookie
 *
 * Both tokens carry the same `jti` (JWT ID) tying them to one row in
 * `active_sessions`. Revoking the session revokes both halves at once.
 *
 * Signing algorithm:
 *   - In production: HS256 from `JWT_SECRET` env (a 32-byte URL-safe random
 *     string). HS256 is appropriate because the API is the sole verifier —
 *     no public/private split is needed for downstream services in V2.
 *     The secret rotates via env var + zero-downtime deploy.
 *   - In dev: if `JWT_SECRET` is not set, the bootstrap throws — there is
 *     no "demo" fallback. Production-grade is the only mode.
 */

const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const OAUTH_STATE_VERSION = 'v1';
const OAUTH_STATE_MAX_COOKIE_BYTES = 4096;
const OAUTH_STATE_KEY_CONTEXT = 'declutrmail:oauth-state:v1:key';

/** Custom claims carried in both access and refresh tokens. */
export interface SessionTokenClaims extends JWTPayload {
  /** User id (uuid) the session belongs to. */
  sub: string;
  /** Workspace id (uuid) — denormalized so guards skip a DB hop. */
  wsid: string;
  /** Session id (uuid) — `active_sessions.id`. */
  sid: string;
  /** JWT id — `active_sessions.jti`. Rotated on every refresh. */
  jti: string;
  /** Token kind — refresh tokens must not be accepted for API requests. */
  kind: 'access' | 'refresh';
}

/** Issued token pair returned to the controller for cookie setting. */
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** Same value as `claims.jti`, surfaced for `active_sessions` writes. */
  jti: string;
  /** Hex SHA-256 of `refreshToken`, surfaced for `active_sessions` writes. */
  refreshTokenHash: string;
  /** Wall-clock expirations — handy for `Set-Cookie maxAge`. */
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

@Injectable()
export class JwtService {
  private readonly accessSecret: Uint8Array;
  private readonly refreshSecret: Uint8Array;
  /** Domain-separated from access-token signing while reusing its mandatory secret. */
  private readonly oauthStateSecret: Uint8Array;

  constructor() {
    const access = process.env.JWT_ACCESS_SECRET;
    const refresh = process.env.JWT_REFRESH_SECRET;
    if (!access || access.length < 32) {
      throw new InternalServerErrorException(
        'JWT_ACCESS_SECRET is missing or shorter than 32 bytes — set a 32+ byte ' +
          'URL-safe random string in the API process env (see .env.example).',
      );
    }
    if (!refresh || refresh.length < 32) {
      throw new InternalServerErrorException(
        'JWT_REFRESH_SECRET is missing or shorter than 32 bytes — set a 32+ byte ' +
          'URL-safe random string in the API process env (see .env.example).',
      );
    }
    if (access === refresh) {
      throw new InternalServerErrorException(
        'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET MUST differ — a compromised ' +
          'access secret would otherwise let an attacker forge refresh tokens.',
      );
    }
    this.accessSecret = new TextEncoder().encode(access);
    this.refreshSecret = new TextEncoder().encode(refresh);
    this.oauthStateSecret = createHmac('sha256', this.accessSecret)
      .update(OAUTH_STATE_KEY_CONTEXT)
      .digest();
  }

  /**
   * Authenticate an OAuth-state payload as a compact, cookie-safe value.
   *
   * The HMAC covers both the format version and the complete base64url
   * payload. OAuth state has its own derived key, so it cannot be confused
   * with an HS256 access token even though both roots come from the existing
   * mandatory JWT_ACCESS_SECRET.
   */
  sealOAuthState(payload: string): string {
    const encodedPayload = Buffer.from(payload, 'utf8').toString('base64url');
    const authenticated = `${OAUTH_STATE_VERSION}.${encodedPayload}`;
    const signature = createHmac('sha256', this.oauthStateSecret)
      .update(authenticated)
      .digest('base64url');
    return `${authenticated}.${signature}`;
  }

  /**
   * Verify and open an OAuth-state cookie. Returns null for every malformed
   * or unauthenticated representation so callers expose one controlled
   * failure instead of a format/signature oracle.
   */
  openOAuthState(cookie: string): string | null {
    if (Buffer.byteLength(cookie, 'utf8') > OAUTH_STATE_MAX_COOKIE_BYTES) return null;

    const parts = cookie.split('.');
    if (parts.length !== 3) return null;
    const [version, encodedPayload, encodedSignature] = parts;
    if (
      version !== OAUTH_STATE_VERSION ||
      !encodedPayload ||
      !/^[A-Za-z0-9_-]+$/.test(encodedPayload) ||
      !encodedSignature ||
      !/^[A-Za-z0-9_-]{43}$/.test(encodedSignature)
    ) {
      return null;
    }

    const authenticated = `${version}.${encodedPayload}`;
    const expected = createHmac('sha256', this.oauthStateSecret).update(authenticated).digest();
    const actual = Buffer.from(encodedSignature, 'base64url');
    if (
      actual.toString('base64url') !== encodedSignature ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return null;
    }

    const decoded = Buffer.from(encodedPayload, 'base64url');
    if (decoded.toString('base64url') !== encodedPayload) return null;
    return decoded.toString('utf8');
  }

  /**
   * Issue an access + refresh pair for a new (or refreshed) session.
   *
   * Both tokens share the same `jti` — that single value is the
   * `active_sessions` row key. Rotation issues a NEW jti for the next
   * pair and the SessionsService revokes the old row.
   */
  async issue(input: {
    userId: string;
    workspaceId: string;
    sessionId: string;
  }): Promise<IssuedTokens> {
    const jti = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const accessExp = now + ACCESS_TOKEN_TTL_SEC;
    const refreshExp = now + REFRESH_TOKEN_TTL_SEC;

    const baseClaims = {
      sub: input.userId,
      wsid: input.workspaceId,
      sid: input.sessionId,
      jti,
    } as const;

    const accessToken = await new SignJWT({ ...baseClaims, kind: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime(accessExp)
      .setJti(jti)
      .sign(this.accessSecret);

    const refreshToken = await new SignJWT({ ...baseClaims, kind: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime(refreshExp)
      .setJti(jti)
      .sign(this.refreshSecret);

    return {
      accessToken,
      refreshToken,
      jti,
      refreshTokenHash: hashRefreshToken(refreshToken),
      accessExpiresAt: new Date(accessExp * 1000),
      refreshExpiresAt: new Date(refreshExp * 1000),
    };
  }

  /**
   * Verify the signature + expiration of a token. Returns the claims
   * on success; throws on signature mismatch, expiry, or malformed
   * input. The CALLER is still responsible for checking
   * `active_sessions.is_revoked` — a signed-but-revoked token is
   * common during the 15-min access-token validity window after a
   * logout.
   */
  async verify(token: string, expectedKind: 'access' | 'refresh'): Promise<SessionTokenClaims> {
    const secret = expectedKind === 'access' ? this.accessSecret : this.refreshSecret;
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });
    const claims = payload as SessionTokenClaims;
    if (claims.kind !== expectedKind) {
      throw new Error(`Token kind mismatch: expected ${expectedKind}, got ${claims.kind}.`);
    }
    return claims;
  }
}

/** SHA-256 hex digest — the exact value stored in `active_sessions.refresh_token_hash`. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
