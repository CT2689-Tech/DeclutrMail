import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { users } from '@declutrmail/db';

import { RateLimit } from '../common/rate-limit/index.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { verifyUnsubscribeToken } from './unsubscribe-token.js';

/**
 * The token is echoed into a form action, so it must not be able to
 * break out of the attribute. Tokens are base64url JWTs and contain
 * none of these characters today — this is defence against a future
 * token format, not a live hole.
 */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * RFC 8058 one-click unsubscribe (D165).
 *
 * UNAUTHENTICATED by necessity — Gmail POSTs this URL with no cookies
 * and no user agent we control. The signed token is the only
 * credential (auth in this API is opt-in per controller; like the
 * Resend webhook, this one attaches no guard, only the D156 rate
 * limit).
 *
 * Every response is an identical 200 regardless of token validity. A
 * 4xx would turn this endpoint into an oracle for which tokens (and
 * therefore which users) exist. The only observable effect of a valid
 * token is that one preference flips OFF — never on, never anything
 * else.
 *
 * ONLY POST MUTATES. The GET renders a confirmation page and touches
 * nothing. This is not REST pedantry: mail clients and corporate
 * security products PREFETCH links in email (Outlook Safe Links,
 * malware scanners, proxy warmers). A GET that unsubscribed would let
 * a scanner silently opt users out of mail they never opened, and the
 * user would have no idea why their notifications stopped.
 */
@Controller('email/unsubscribe')
export class UnsubscribeController {
  private readonly logger = new Logger(UnsubscribeController.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /** The mutating route. Gmail's one-click POST lands here. */
  @Post()
  // RFC 8058 §3.2 expects 200; Nest's POST default is 201.
  @HttpCode(HttpStatus.OK)
  @RateLimit('default')
  async unsubscribe(
    @Query('t') queryToken?: string,
    @Body() _body?: unknown,
  ): Promise<{ status: 'ok' }> {
    await this.apply(queryToken);
    return { status: 'ok' };
  }

  /**
   * READ-ONLY. Backs the footer link a human clicks: renders a page
   * whose button POSTs the same token. Prefetchers hit this and change
   * nothing.
   */
  @Get()
  @RateLimit('default')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async confirmPage(@Query('t') queryToken?: string): Promise<string> {
    // Deliberately does NOT verify the token: a verification result
    // here would be an enumeration oracle, and there is nothing to
    // protect — the page mutates nothing. An invalid token simply
    // yields a POST that no-ops.
    const token = queryToken ?? '';
    return [
      '<!doctype html><html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>Unsubscribe · DeclutrMail</title></head>',
      '<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;',
      'max-width:420px;margin:80px auto;padding:0 24px;color:#111">',
      '<h1 style="font-size:20px;margin:0 0 12px">Turn off these emails?</h1>',
      '<p style="color:#666;font-size:14px;line-height:20px;margin:0 0 24px">',
      'You will still receive required account notices, such as billing ',
      'and account deletion.</p>',
      `<form method="POST" action="/api/email/unsubscribe?t=${escapeHtmlAttr(token)}">`,
      '<button type="submit" style="background:#000;color:#fff;border:0;',
      'border-radius:6px;padding:10px 20px;font-size:14px;cursor:pointer">',
      'Unsubscribe</button></form></body></html>',
    ].join('');
  }

  private async apply(token: string | undefined): Promise<void> {
    if (!token) {
      this.logger.log('email.unsubscribe.no_token');
      return;
    }
    const claims = await verifyUnsubscribeToken(token);
    if (!claims) {
      this.logger.warn('email.unsubscribe.invalid_token');
      return;
    }
    const [row] = await this.db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, claims.userId))
      .limit(1);
    if (!row) {
      this.logger.log('email.unsubscribe.user_gone');
      return;
    }
    // Merge over the RAW stored bag, not over `parseEmailPrefs()`
    // output: the parser falls back to DEFAULTS (all true) for a
    // malformed or future-shaped bag, and writing that back would let
    // this unauthenticated endpoint flip a stored opt-out back ON.
    // Spreading the raw object flips exactly one key to `false` and
    // passes every other stored key through untouched — the endpoint
    // can only ever narrow.
    const base = (row.preferences ?? {}) as Record<string, unknown>;
    const rawEmailPrefs = base.emailPrefs;
    const storedEmailPrefs =
      typeof rawEmailPrefs === 'object' && rawEmailPrefs !== null && !Array.isArray(rawEmailPrefs)
        ? (rawEmailPrefs as Record<string, unknown>)
        : {};
    await this.db
      .update(users)
      .set({
        preferences: { ...base, emailPrefs: { ...storedEmailPrefs, [claims.category]: false } },
      })
      .where(eq(users.id, claims.userId));
    // Never log the address or the token — category + outcome only (D7).
    this.logger.log(`email.unsubscribe.applied category=${claims.category}`);
  }
}
