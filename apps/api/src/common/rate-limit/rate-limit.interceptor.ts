import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { type Observable } from 'rxjs';

import {
  BUCKET_DEFAULTS,
  type BucketName,
  type RateLimitOptions,
  type ResolvedRateLimit,
  type TokenBucketStore,
  RATE_LIMIT_METADATA,
} from './rate-limit.types.js';
import {
  type SecurityEventSeverity,
  SecurityEventsService,
} from '../../security-events/security-events.service.js';

/** DI token for the store. Optional — fail-open if absent. */
export const TOKEN_BUCKET_STORE = 'TOKEN_BUCKET_STORE';

/**
 * Per-bucket severity for the D181 `rate_limit.breach` audit emit.
 *
 *   - `auth`         → `critical` — login / OAuth callback breaches are a
 *     brute-force signal; operator must see them unfiltered.
 *   - `gmail-action` → `warning`  — destructive Gmail mutations; an abuse
 *     signal but routine retry traffic looks similar.
 *   - `triage-load`  → `info`     — list endpoints; a scraper-style spike
 *     is noteworthy but not alertable on its own.
 *   - `default`      → `warning`  — catch-all; chosen one step ABOVE the
 *     read tier so a route that forgot to pick a bucket isn't silently
 *     downgraded to noise.
 *
 * Severity is the operator's primary triage filter; bucket is the
 * `payload.bucket` field for the secondary breakdown.
 */
const BUCKET_BREACH_SEVERITY: Readonly<Record<BucketName, SecurityEventSeverity>> = {
  auth: 'critical',
  'gmail-action': 'warning',
  'triage-load': 'info',
  default: 'warning',
};

/**
 * Authenticated-request alias. The JwtGuard (D155) attaches
 * `req.user` (SessionPrincipal) on success — declared globally in
 * `jwt.guard.ts`. The interceptor reads only `userId` so it stays
 * unaware of the auth feature surface (D204).
 */
type AuthenticatedRequest = Request;

/**
 * Global rate-limit interceptor (D156).
 *
 * Flow per request:
 *   1. Read `@RateLimit(...)` metadata. Absent → pass through (opt-in).
 *   2. Resolve key as `${bucket}:${req.user?.id ?? req.ip}`.
 *   3. Call `store.consume(...)`. On `allowed=false`, throw a 429 with
 *      `Retry-After` header set to seconds until refill.
 *   4. On store error (Redis down, network blip), log + count and
 *      **fail open** — a rate-limit infra blip must not crash the app.
 *
 * Privacy (D7): we log bucket + key suffix + outcome only. Never the
 * request body, never headers beyond what's needed, never query params.
 */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RateLimitInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(TOKEN_BUCKET_STORE) private readonly store: TokenBucketStore | null,
    // Optional so the rate-limit feature stays decoupled (and unit tests
    // can construct the interceptor without DI). When wired (D181), a
    // breach is recorded to the security audit log fire-and-forget.
    //
    // Why `@Inject(SecurityEventsService)` is mandatory here even though
    // the type annotation IS the class: a union type like
    // `SecurityEventsService | null` collapses Nest's `design:paramtypes`
    // reflect metadata to `Object`, so without an explicit `@Inject(...)`
    // token Nest would try to resolve `Object` (no provider), `@Optional()`
    // would default this to `null`, and the breach emit would silently
    // no-op in production — observed live on main 2026-05-29 (smoke run:
    // 429 fired, NO `rate_limit.breach` row landed because the recorder
    // was null). Constructor smell tests for any DI-injected service
    // typed as `T | null`: add `@Inject(T)` or drop the `| null`.
    @Optional()
    @Inject(SecurityEventsService)
    private readonly securityEvents: SecurityEventsService | null = null,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const opts = this.readOptions(context);
    if (!opts) {
      // Unannotated route — pass through. Opt-in by design (CLAUDE.md §1.2).
      return next.handle();
    }

    if (!this.store) {
      // No store wired (e.g. REDIS_URL absent in local dev). Fail open
      // — the alternative is bricking every annotated route in dev.
      return next.handle();
    }

    const resolved = this.resolve(opts);
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const res = http.getResponse<Response>();
    const key = `${resolved.bucket}:${this.identify(req)}`;

    let result;
    try {
      result = await this.store.consume(key, resolved, Date.now());
    } catch (err) {
      // Fail-open: log structured, allow request. The Sentry counter
      // wiring (D159) will hook off `kind: 'rate_limit.store_error'`
      // log lines and alert if these spike.
      this.logger.error(
        JSON.stringify({
          kind: 'rate_limit.store_error',
          bucket: resolved.bucket,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return next.handle();
    }

    if (!result.allowed) {
      // D181: record the breach to the security audit log, fire-and-forget
      // (record() never throws). Metadata only — bucket + caller IP +
      // user id — never request body or query (D7). Severity comes from
      // BUCKET_BREACH_SEVERITY so an auth-bucket breach (brute-force
      // signal) surfaces above a triage-load scraper at operator-read
      // time.
      void this.securityEvents?.record({
        eventType: 'rate_limit.breach',
        severity: BUCKET_BREACH_SEVERITY[resolved.bucket],
        userId: req.user?.userId ?? null,
        sourceIp: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        payload: { bucket: resolved.bucket },
      });

      res.setHeader('Retry-After', String(result.retryAfterSec));
      // Throw a 429; AllExceptionsFilter formats the D168/D202 envelope
      // as `{ error: { code: 'RATE_LIMITED', message } }` (the filter's
      // `codeForStatus` maps HTTP 429 → 'RATE_LIMITED'). The retry-after
      // value travels in the header, not the body — standard HTTP, and
      // the body stays minimal (no PII surface).
      throw new HttpException(
        'Too many requests. Try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return next.handle();
  }

  /**
   * Pull `RateLimitOptions` from either the handler or the controller
   * class — handler wins. Allows `@RateLimit('auth') @Controller(...)`
   * to apply a default that individual handlers can override.
   */
  private readOptions(context: ExecutionContext): RateLimitOptions | null {
    return (
      this.reflector.get<RateLimitOptions>(RATE_LIMIT_METADATA, context.getHandler()) ??
      this.reflector.get<RateLimitOptions>(RATE_LIMIT_METADATA, context.getClass()) ??
      null
    );
  }

  /** Apply per-bucket defaults to any unset fields. */
  private resolve(opts: RateLimitOptions): ResolvedRateLimit {
    const defaults = BUCKET_DEFAULTS[opts.bucket];
    return {
      bucket: opts.bucket,
      limit: opts.limit ?? defaults.limit,
      windowSec: opts.windowSec ?? defaults.windowSec,
    };
  }

  /**
   * Identify the caller. Prefers a session-attached user id (D109);
   * falls back to client IP. `req.ip` respects Express's `trust proxy`
   * setting, which the API must enable in main.ts for accurate IPs
   * behind Cloud Run's load balancer (added in this PR).
   *
   * NEVER pulls request body. Never pulls headers beyond `req.ip`'s
   * derivation. D7-clean.
   */
  private identify(req: AuthenticatedRequest): string {
    const userId = req.user?.userId;
    if (typeof userId === 'string' && userId.length > 0) {
      return `user:${userId}`;
    }
    return `ip:${req.ip ?? 'unknown'}`;
  }
}
