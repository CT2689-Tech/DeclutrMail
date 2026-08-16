import { Controller, Get, Inject, Param, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import { JwtGuard } from '../auth/jwt.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { IconErrorFilter } from './icon-error.filter.js';
import { IconsService } from './icons.service.js';

/**
 * A resolved mark is stable, so revalidate daily rather than pinning
 * `immutable` — a rebrand lands within a day and the strong ETag makes
 * the revalidation a 304.
 */
export const HIT_CACHE_CONTROL = 'private, max-age=86400, stale-while-revalidate=604800';

/**
 * A MISS IS PROVISIONAL AND MUST NOT CARRY THE HIT'S LIFETIME.
 *
 * This route answers 204 for every domain it has never seen, because
 * the lookup only ENQUEUES resolution — the mark lands in the cache
 * seconds later, from the worker. Sending the hit's `max-age=86400,
 * stale-while-revalidate=604800` with that 204 meant the browser
 * committed to "this sender has no logo" for a day, and kept serving
 * it stale for a week after. Since every domain starts as a miss, the
 * first ever page view poisoned the cache for every sender at once,
 * and no amount of successful resolution afterwards could show a
 * single logo. That is what "the icons are still failing" looked like
 * from the outside (incident 2026-08-16 — see MISTAKES.md).
 *
 * It also produced the misleading evidence: `stale-while-revalidate`
 * makes Chromium fire a background revalidation that DevTools reports
 * with no initiator, type `Other`, 0 B, and — when the page navigates
 * before it lands — `(failed) net::ERR_ABORTED`. A wall of those reads
 * exactly like a broken endpoint. It was the caching directive.
 *
 * 60s instead: long enough to collapse the fan-out of one browsing
 * session (a Senders page draws ~50 avatars, and re-renders and
 * back/forward within the minute cost nothing), short enough that the
 * next visit picks up whatever the worker resolved in the meantime.
 * No `stale-while-revalidate` — a provisional answer should be asked
 * again, not served stale in the background.
 */
export const MISS_CACHE_CONTROL = 'private, max-age=60';

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
// Failures answer with a status and no body — see the filter. A JSON
// error body here is silently eaten by Chromium's ORB, which is what
// hid the real status code through three rounds of debugging.
@UseFilters(IconErrorFilter)
export class IconsController {
  // Explicit token rather than constructor-type inference: the test
  // runner does not emit `design:paramtypes`, so type-based resolution
  // silently yields `undefined` here and every route 500s.
  constructor(@Inject(IconsService) private readonly icons: IconsService) {}

  @Get(':domain')
  // Explicit limit, which is what matters here: an override makes the
  // interceptor use a ROUTE-SCOPED key instead of the shared
  // `triage-load:user:<id>` pool. Without it this route would drain the
  // same 120/min counter the sender and triage list reads are checked
  // against — and it fans out one request per distinct sender domain on
  // a page, so a couple of scrolls would 429 the user's actual data.
  // That exact starvation is recorded as a live incident in
  // `rate-limit.interceptor.ts` (2026-06-11, sender-detail e2e loads).
  //
  // 600/min suits the fan-out: these are primary-key lookups against
  // our own Postgres, and the response is browser-cached for a day, so
  // repeat views cost nothing. Still a hard wall for a scraper.
  @RateLimit({ bucket: 'triage-load', limit: 600, windowSec: 60 })
  async icon(
    @Param('domain') domain: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.icons.lookup(domain);

    if (result.kind === 'miss') {
      res.setHeader('Cache-Control', MISS_CACHE_CONTROL);
      res.status(204).end();
      return;
    }

    // Set before the 304 too, so a revalidation restarts the freshness
    // window rather than leaving the entry stale on every later view.
    res.setHeader('Cache-Control', HIT_CACHE_CONTROL);

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
