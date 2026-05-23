import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { SyncStatusSchema, type SyncStatus } from '@declutrmail/shared/contracts';

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
 * TODO(D202): wrap the response in the `{ data, meta }` envelope when
 * the shared envelope helper lands. The route returns the bare payload
 * for now so the client contract is stable; the envelope is a
 * non-breaking outer wrapper.
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

  @Get('status')
  async getStatus(@Query('mailboxAccountId') mailboxAccountId?: string): Promise<SyncStatus> {
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
    return result.data;
  }
}
