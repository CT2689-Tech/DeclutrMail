import { Controller, Get, Header, Inject, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import { JwtGuard } from '../auth/jwt.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { IconsService } from './icons.service.js';

/**
 * Brand icon route (ADR-0034).
 *
 *   GET /api/icons/:domain → 200 image/svg+xml | 304 | 204
 *
 * ENVELOPE EXEMPTION (ADR-0008). This is the one route that returns
 * raw bytes rather than the `{ok,data}` envelope: it is an `<img>`
 * source, and an image element cannot parse JSON. Status codes carry
 * the whole contract instead.
 *
 *   200 — the mark, with a strong ETag.
 *   304 — the caller's ETag still matches.
 *   204 — no mark. NOT an error: it means "render the monogram". The
 *         caller cannot distinguish "never looked", "nothing
 *         published", or "bad domain", and does not need to — the
 *         rendered result is identical in all three.
 *
 * AUTHENTICATED, despite returning no user data. Two reasons, both
 * about what an anonymous caller could otherwise do:
 *
 *   1. A miss ENQUEUES an outbound resolution. Unauthenticated, that
 *      is a stranger driving our DNS and HTTPS fetches at domains of
 *      their choosing, and filling our cache table while they do it.
 *   2. The cache is a global set of domains our users receive mail
 *      from. Anonymous probing turns it into an oracle for that set —
 *      aggregate, but not something to hand out.
 *
 * Cookies reach it from an `<img>` because API and web share a
 * registrable domain (`COOKIE_DOMAIN`), so the `SameSite=Lax` session
 * cookie is sent on this subresource request. If it ever is not, every
 * icon 401s and the UI shows monograms — the same floor as any other
 * failure, which is why this route needs no fallback of its own.
 *
 * Privacy (D7, D228): no Gmail data is read, written, or logged here.
 */
@Controller('icons')
@UseGuards(JwtGuard)
export class IconsController {
  // Explicit token rather than constructor-type inference: the test
  // runner does not emit `design:paramtypes`, so type-based resolution
  // silently yields `undefined` here and every route 500s.
  constructor(@Inject(IconsService) private readonly icons: IconsService) {}

  @Get(':domain')
  // Shares the read bucket: this is a read against OUR Postgres, and a
  // grid render fans out one request per distinct sender domain, so
  // the limit has to tolerate the same burst a page load does.
  @RateLimit('triage-load')
  // Revalidate daily rather than pinning `immutable`: a rebrand should
  // land within a day, and the ETag makes the revalidation free.
  @Header('Cache-Control', 'private, max-age=86400, stale-while-revalidate=604800')
  async icon(
    @Param('domain') domain: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.icons.lookup(domain);

    if (result.kind === 'miss') {
      res.status(204).end();
      return;
    }

    if (req.headers['if-none-match'] === result.etag) {
      res.status(304).end();
      return;
    }

    res.setHeader('ETag', result.etag);
    res.setHeader('Content-Type', result.mime);
    // Defence in depth for the SVG we serve from our own origin. The
    // bytes were already validated against SVG Tiny PS (no script, no
    // external refs) at resolution time, and an `<img>` context does
    // not execute script — these headers cover the case where someone
    // opens the URL directly.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(result.image);
  }
}
