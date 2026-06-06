import {
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ok,
  SyncStatusSchema,
  type Envelope,
  type SyncStatus,
} from '@declutrmail/shared/contracts';

import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { SyncService, syncNotReady } from './sync.service.js';

/**
 * Sync gate transport (D224, D109) + on-demand "Sync now" producer
 * (D38 prod-ready pass).
 *
 *   GET  /api/v1/sync/status      → SyncStatus (active mailbox from session)
 *   POST /api/v1/sync/incremental → { enqueued | noop | not_ready }
 *
 * The onboarding sync gate (D6, D109) polls `GET /status` every 3s via
 * `useSyncStatus()` (D200, TanStack Query). There is no push transport
 * — D6 lifecycle events (`sync.started`, `sync.progress`, …) emit to
 * PostHog/Sentry server-side only (D159), never to the client.
 *
 * `POST /incremental` is the user-facing "Sync now" surface. It does
 * NOT touch Gmail directly; it enqueues an incremental-sync job from
 * the current `provider_sync_state.last_history_id` cursor. BullMQ
 * dedups by `${mailbox}:${cursor}` so consecutive clicks for the same
 * cursor return `noop`. A separate 5-min cron in `apps/api/src/worker.ts`
 * sweeps mailboxes whose cursor hasn't advanced in 10+ min (drift
 * recovery while Pub/Sub registration finishes rolling out).
 *
 * AUTH (D155 + D205): `JwtGuard` + `CurrentMailboxGuard` resolve the
 * authenticated mailbox; the controller reads it via `@CurrentMailbox()`.
 * The pre-session `?mailboxAccountId=` query param is gone.
 *
 * Privacy posture (§2.1): both responses carry only stage enums + a
 * numeric percentage + an allowlisted boolean + a string cursor id.
 * No body content, no headers, no message-derived data of any kind.
 * `privacy-auditor` verifies this.
 */
@Controller('v1/sync')
@UseGuards(JwtGuard, CurrentMailboxGuard)
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
  async getStatus(@CurrentMailbox() mailbox: { id: string }): Promise<Envelope<SyncStatus>> {
    const status = await this.sync.getStatus(mailbox.id);
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

  /**
   * On-demand incremental sync — the "Sync now" button.
   *
   * Rate-limit (D156): `gmail-action` bucket with a per-route override
   * of 6/min. The button itself debounces in the FE; this is the
   * server-side ceiling against abuse — one click spawns at most one
   * incremental-sync job (which in turn hits Gmail history.list). The
   * cap keeps a tight enough lid that a frothy click loop cannot
   * exhaust the per-user Gmail quota budget (D5).
   *
   * Returns 202 Accepted with the enqueue outcome so the FE can render
   * "Queued" vs "Already in flight" without re-polling status.
   *
   * The 409 SYNC_NOT_READY outcome is a designed state — initial sync
   * hasn't completed yet, so there's no cursor to advance from. The FE
   * renders the sync-gate progress card instead of an error toast,
   * per CLAUDE.md §8 "guard-4xx-as-designed-state".
   */
  @RateLimit({ bucket: 'gmail-action', limit: 6, windowSec: 60 })
  @Post('incremental')
  @HttpCode(202)
  async postIncremental(
    @CurrentMailbox() mailbox: { id: string },
  ): Promise<Envelope<{ outcome: 'enqueued' | 'noop'; cursor_history_id: string }>> {
    const result = await this.sync.enqueueManualIncrementalSync(mailbox.id, 'manual');

    if (result.kind === 'not_ready') {
      throw syncNotReady();
    }

    return ok({
      outcome: result.kind,
      cursor_history_id: result.cursorHistoryId,
    });
  }
}
