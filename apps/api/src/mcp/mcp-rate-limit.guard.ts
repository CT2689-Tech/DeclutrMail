import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { TOKEN_BUCKET_STORE } from '../common/rate-limit/rate-limit.interceptor.js';
import type { ResolvedRateLimit, TokenBucketStore } from '../common/rate-limit/rate-limit.types.js';

/**
 * Requests per minute to `/mcp` from one address, counted BEFORE the
 * token is looked up. A hosted client (Claude, ChatGPT) calls from a few
 * shared addresses for all of its users, so this is sized for many
 * people at once, not one; the per-user budgets inside the tools are the
 * limits a real person meets first. What it bounds is the token lookups
 * one address can cause, each a single indexed read.
 */
const PER_ADDRESS: ResolvedRateLimit = { bucket: 'default', limit: 3000, windowSec: 60 };

/**
 * A guard, not `@RateLimit`: Nest runs guards before interceptors, so
 * the interceptor-based limiter would count a request only after
 * `McpTokenGuard` had already done its database lookup for it.
 *
 * Fails open on a store error, exactly as the interceptor does — a Redis
 * blip must not take the connector down.
 */
@Injectable()
export class McpRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(McpRateLimitGuard.name);

  constructor(
    @Optional() @Inject(TOKEN_BUCKET_STORE) private readonly buckets: TokenBucketStore | null,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.buckets) return true;
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    let result;
    try {
      result = await this.buckets.consume(`mcp:ip:${req.ip ?? 'unknown'}`, PER_ADDRESS, Date.now());
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          kind: 'rate_limit.store_error',
          bucket: 'mcp',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return true;
    }
    if (!result.allowed) {
      http.getResponse<Response>().setHeader('Retry-After', String(result.retryAfterSec));
      throw new HttpException(
        'Too many requests. Try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
