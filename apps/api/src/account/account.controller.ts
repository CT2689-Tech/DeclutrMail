import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  AccountDeletionRequestSchema,
  ok,
  type AccountDeletionStatus,
  type Envelope,
} from '@declutrmail/shared/contracts';

import { AppException } from '../common/app-exception.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { AccountDeletionOrchestrator } from './deletion.service.js';

/** Session principal shape attached by JwtGuard. */
interface Principal {
  userId: string;
  workspaceId: string;
}

/**
 * AccountController — `/account/deletion` endpoints (D205, D216, D232).
 *
 * AUTH: `JwtGuard` only — deliberately NO `CurrentMailboxGuard`.
 * Account deletion is USER-scoped and must work with zero connected
 * mailboxes (D232: "delete inbox data while OAuth stays connected" AND
 * the disconnected-everything case both reach this surface). Mutations
 * additionally take `CsrfGuard` (double-submit cookie) + rate limiting.
 *
 * Response shape: D202 envelope. Both mutations return the SAME
 * `AccountDeletionStatus` payload as the GET so the FE cache update is
 * a single setQueryData regardless of which call ran.
 *
 * The typed confirmation phrase is validated server-side in the
 * orchestrator (`DELETION_CONFIRM_MISMATCH` 400) — the FE typed-confirm
 * input is UX, not the gate.
 */
@Controller('account')
@UseGuards(JwtGuard)
export class AccountController {
  constructor(private readonly deletion: AccountDeletionOrchestrator) {}

  /** GET /api/account/deletion — pending request + fresh D232 projection. */
  @Get('deletion')
  @RateLimit('default')
  async status(@CurrentUser() principal: Principal): Promise<Envelope<AccountDeletionStatus>> {
    return ok(await this.deletion.getStatus(principal.userId));
  }

  /**
   * POST /api/account/deletion — schedule deletion (typed confirm).
   * `DELETE` → D232 max-of schedule; `DELETE AND WAIVE UNDO` → waived
   * immediate. Anything else → 400.
   */
  @Post('deletion')
  @UseGuards(CsrfGuard)
  @RateLimit({ bucket: 'default', limit: 5, windowSec: 60 })
  async request(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ): Promise<Envelope<AccountDeletionStatus>> {
    const parsed = AccountDeletionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppException({
        code: 'BAD_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid deletion request.',
      });
    }
    return ok(await this.deletion.requestDeletion(principal, parsed.data));
  }

  /** POST /api/account/deletion/cancel — cancel during the grace window. */
  @Post('deletion/cancel')
  @UseGuards(CsrfGuard)
  @RateLimit({ bucket: 'default', limit: 10, windowSec: 60 })
  async cancel(@CurrentUser() principal: Principal): Promise<Envelope<AccountDeletionStatus>> {
    return ok(await this.deletion.cancel(principal.userId));
  }
}
