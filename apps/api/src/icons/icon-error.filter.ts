import { Catch } from '@nestjs/common';
import type { Response } from 'express';

import { AllExceptionsFilter } from '../common/all-exceptions.filter.js';

/**
 * Failures on `GET /api/icons/:domain` answer with a STATUS AND NO BODY.
 *
 * ADR-0008 already exempts this route from the `{ok,data}` envelope on
 * the success path, for the obvious reason: the caller is an image, and
 * an image cannot parse JSON. The ERROR path never honoured that. The
 * global filter wrote `{error:{…}}` with `Content-Type: application/json`
 * — and because the API sends `X-Content-Type-Options: nosniff` on every
 * response, Chromium's Opaque Response Blocking refuses a JSON body
 * delivered to a cross-origin no-cors image request.
 *
 * The cost was not the failed logo — a failed logo is a monogram, which
 * is fine. The cost was that ORB drops the response BEFORE the status
 * reaches the page, so DevTools shows
 *
 *   (failed) net::ERR_BLOCKED_BY_ORB   Type: Other   Size: 0.0 kB
 *
 * with no status code at all, and the Issues panel reports it only as
 * "Response was blocked by CORB". Three rounds of investigation
 * (#528, #530, #533) could not see whether the endpoint was answering
 * 401, 429, 404 or 500, because our own error body was what stopped it
 * being visible. A bodiless response is never ORB-eligible, so the real
 * status shows up in the network panel exactly as it should have all
 * along.
 *
 * Extends rather than replaces `AllExceptionsFilter`: classification,
 * the correlation/display ids, the structured error log and the Sentry
 * capture are identical for this route and must keep happening. Only
 * the bytes on the wire change.
 */
@Catch()
export class IconErrorFilter extends AllExceptionsFilter {
  protected override respond(res: Response, status: number): void {
    // Both headers must go: Express sets Content-Type when the handler
    // or an earlier interceptor touched it, and a stale Content-Length
    // would contradict the empty body.
    res.removeHeader('Content-Type');
    res.removeHeader('Content-Length');
    res.status(status).end();
  }
}
