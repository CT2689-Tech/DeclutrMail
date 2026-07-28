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

import { eq, sql } from 'drizzle-orm';

import { users } from '@declutrmail/db';

import { RateLimit } from '../common/rate-limit/index.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { OPT_OUT_CATEGORIES, verifyUnsubscribeToken } from './unsubscribe-token.js';

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
      '<h1 style="font-size:20px;margin:0 0 12px">Turn off DeclutrMail emails?</h1>',
      '<p style="color:#666;font-size:14px;line-height:20px;margin:0 0 24px">',
      'This stops every optional email &mdash; sync updates and reminders. ',
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
    // Which keys this token turns off. `'all'` is what every email
    // ships: a link labelled plainly "Unsubscribe" is read as "stop
    // sending me this kind of mail", and CAN-SPAM §316.5 requires an
    // option that stops ALL commercial mail. Flipping one category
    // while a sibling kept arriving would break both.
    const turnOff = claims.scope === 'all' ? OPT_OUT_CATEGORIES : [claims.scope];
    const offPatch = Object.fromEntries(turnOff.map((key) => [key, false]));

    // ONE atomic in-database mutation — no read-modify-write. A
    // SELECT-then-UPDATE would race the authed settings PATCH: a
    // preference changed between the two statements gets overwritten
    // with this handler's stale snapshot, which can resurrect an
    // opt-out. The merge computes from the row's CURRENT value under
    // the row lock, flips only the entitled keys to `false`, and
    // passes every other stored key — known or future-shaped — through
    // untouched. Never merge `parseEmailPrefs()` output here either:
    // its default fallback (all true) written back would let this
    // unauthenticated endpoint turn preferences ON. The CASE arms
    // repair malformation at both levels: a non-object ROOT (`||` on an
    // array root CONCATENATES instead of merging) and a non-object
    // `emailPrefs` (same, one level down).
    const root = sql`CASE
      WHEN jsonb_typeof(${users.preferences}) = 'object' THEN ${users.preferences}
      ELSE '{}'::jsonb
    END`;
    const currentPrefs = sql`CASE
      WHEN jsonb_typeof(${root} -> 'emailPrefs') = 'object' THEN ${root} -> 'emailPrefs'
      ELSE '{}'::jsonb
    END`;
    const updated = await this.db
      .update(users)
      .set({
        preferences: sql`jsonb_set(
          ${root},
          '{emailPrefs}',
          ${currentPrefs} || ${JSON.stringify(offPatch)}::jsonb
        )`,
      })
      .where(eq(users.id, claims.userId))
      .returning({ id: users.id });
    if (updated.length === 0) {
      this.logger.log('email.unsubscribe.user_gone');
      return;
    }
    // Never log the address or the token — scope + outcome only (D7).
    this.logger.log(`email.unsubscribe.applied scope=${claims.scope}`);
  }
}
