import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Query,
} from '@nestjs/common';
import {
  ok,
  SyncStatusSchema,
  type Envelope,
  type SyncStatus,
} from '@declutrmail/shared/contracts';

import { RateLimit } from '../common/rate-limit/index.js';
import { SyncService } from './sync.service.js';

/**
 * Sync gate transport (D224).
 *
 *   GET /api/v1/sync/status?mailboxAccountId=<uuid> → SyncStatus
 *
 * The onboarding sync gate (D6, D109) polls this every 3s via
 * `useSyncStatus()` (D200, TanStack Query). There is no push transport
 * — D6 lifecycle events (`sync.started`, `sync.progress`, …) emit to
 * PostHog/Sentry server-side only (D159), never to the client.
 *
 * The response is validated against `SyncStatusSchema` at the boundary
 * before being returned — a misbehaving worker that writes an
 * out-of-range `progress_pct` (or any other shape drift) fails the
 * request loudly instead of leaking malformed state to the UI.
 *
 * Privacy posture (§2.1): the payload carries only stage enums, a
 * numeric percentage, and an allowlisted boolean. No body content, no
 * headers, no message-derived data of any kind. `privacy-auditor`
 * verifies this.
 *
 * Response shape: `{ data: SyncStatus }` (D202 envelope via `ok()`).
 * The FE `useSyncStatus()` hook reads `response.data`.
 *
 * TODO(D109/auth): once session auth lands, the `mailboxAccountId`
 * comes from the authenticated session, not a query parameter. The
 * query-string form is a stop-gap matching the existing connect-route
 * pattern (see `GoogleOAuthController`) and lives behind
 * `GMAIL_CONNECT_ENABLED` for the same reason.
 */
@Controller('v1/sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /**
   * Rate-limit (D156): `triage-load` bucket with a per-route override
   * of 120/min = 2/sec. The FE `useSyncStatus()` hook polls every 3s
   * (~0.33/sec steady-state) so 2/sec leaves 6× headroom for the
   * page-load burst + a couple of fast refetches; abusive clients are
   * still capped well below the worker's Gmail-quota budget.
   */
  @RateLimit({ bucket: 'triage-load', limit: 120, windowSec: 60 })
  @Get('status')
  async getStatus(
    @Query('mailboxAccountId') mailboxAccountId?: string,
  ): Promise<Envelope<SyncStatus>> {
    if (!mailboxAccountId) {
      throw new BadRequestException('Missing required query parameter: mailboxAccountId.');
    }

    const status = await this.sync.getStatus(mailboxAccountId);
    if (status === null) {
      throw new NotFoundException('No sync state for the given mailbox.');
    }

    // Validate at the boundary — a worker bug that wrote `progress_pct
    // = 150` (or any other shape drift) becomes a 500 here, never
    // reaches the UI. SyncStatusSchema is the wire-format source of
    // truth (D224).
    const result = SyncStatusSchema.safeParse(status);
    if (!result.success) {
      throw new InternalServerErrorException('Sync state failed contract validation.');
    }
    return ok(result.data);
  }
}
