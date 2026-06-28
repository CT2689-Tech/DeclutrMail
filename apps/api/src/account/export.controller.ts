import { Controller, Get, Logger, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { Readable } from 'node:stream';

import { DataExportFormatSchema } from '@declutrmail/shared/contracts';

import { AppException } from '../common/app-exception.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { DataExportService } from './export.service.js';

/** Session principal shape attached by JwtGuard. */
interface Principal {
  userId: string;
  workspaceId: string;
}

/**
 * GET /api/account/export — the D116/DPDP data export download.
 *
 * AUTH: `JwtGuard` only — USER-scoped like the deletion routes (the
 * export must work with zero connected mailboxes and covers every
 * mailbox in the workspace). A GET carries no CSRF guard by design
 * (reads are not state-changing); the session cookie is the auth.
 *
 * RESPONSE: a file stream (`Content-Disposition: attachment`), NOT the
 * D202 envelope — the documented exemption for binary/file downloads.
 * Errors thrown before the stream starts (bad format, 401, 429) still
 * produce the standard error envelope via AllExceptionsFilter.
 *
 * RATE LIMIT: 5 / 5 min per user — the export walks the whole metadata
 * index; it is the most expensive read on the API. Batching inside
 * `DataExportService` keeps memory flat; the limiter keeps a retry
 * loop from turning it into a self-DoS.
 *
 * PRIVACY (D7/D228): see `DataExportService` — explicit-column selects
 * over the storage allowlist only; bodies don't exist in the DB and
 * OAuth token columns are never selected.
 */
@Controller('account')
@UseGuards(JwtGuard)
export class DataExportController {
  private readonly logger = new Logger(DataExportController.name);

  constructor(private readonly exporter: DataExportService) {}

  @Get('export')
  @RateLimit({ bucket: 'default', limit: 5, windowSec: 300 })
  export(@CurrentUser() principal: Principal, @Query('format') rawFormat: string | undefined) {
    const parsed = DataExportFormatSchema.safeParse(rawFormat ?? 'json');
    if (!parsed.success) {
      throw new AppException({
        code: 'BAD_REQUEST',
        message: "Invalid export format — use 'json' or 'csv'.",
      });
    }
    const format = parsed.data;
    const date = new Date().toISOString().slice(0, 10);
    const source =
      format === 'csv'
        ? this.exporter.streamCsv(principal.workspaceId)
        : this.exporter.streamJson(principal.workspaceId);
    return new StreamableFile(
      Readable.from(this.guardStream(source, format, principal.workspaceId)),
      {
        type: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
        disposition: `attachment; filename="declutrmail-export-${date}.${format}"`,
      },
    );
  }

  /**
   * Re-yield the export stream, logging + aborting on a mid-stream
   * failure. The 200 + Content-Disposition headers are flushed before
   * the first row, so a DB error mid-stream (connection drop, statement
   * timeout — likeliest on the large mailboxes this feature targets)
   * cannot become a clean response. Re-throwing destroys the readable,
   * so the client sees an aborted transfer (a broken download) instead
   * of a truncated file reported as a successful 200, and the failure
   * leaves a server-side signal.
   */
  private async *guardStream(
    source: AsyncGenerator<string>,
    format: string,
    workspaceId: string,
  ): AsyncGenerator<string> {
    try {
      yield* source;
    } catch (err) {
      this.logger.error(
        `Data export failed mid-stream (workspace=${workspaceId}, format=${format}) — aborting transfer`,
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }
  }
}
