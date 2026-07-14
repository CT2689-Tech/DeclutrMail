import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import {
  MailboxDataDeletionRequestSchema,
  ok,
  QuietHoursConfigSchema,
  type Envelope,
  type MailboxDataDeletionReceipt,
  type QuietHoursState,
} from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { CapabilityGuard, RequiresCapability } from '../common/entitlements/capability.guard.js';
import { AppException } from '../common/app-exception.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { UsersService } from '../users/users.service.js';
import { MailboxAccountsService, type MailboxSummary } from './mailbox-accounts.service.js';

/**
 * Mailboxes routes (D205 MailboxAccountsModule).
 *
 *   GET    /api/mailboxes                   → list workspace mailboxes
 *   DELETE /api/mailboxes/:id               → disconnect (revoke + nullify)
 *   POST   /api/mailboxes/:id/indexed-data-deletion → disconnect + schedule mailbox purge
 *   PATCH  /api/mailboxes/:id/active        → set as the user's active mailbox
 *   GET    /api/mailboxes/:id/quiet-hours   → quiet-hours config + activeNow (U18, D92/D95)
 *   PUT    /api/mailboxes/:id/quiet-hours   → replace quiet-hours config (jsonb-merge write)
 *
 * All routes require JwtGuard. State-changing routes also require
 * CsrfGuard. Ownership scoping happens in the service layer —
 * controllers never query by mailbox id without a workspace filter.
 */
@Controller('mailboxes')
@UseGuards(JwtGuard)
export class MailboxesController {
  constructor(
    private readonly mailboxes: MailboxAccountsService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: SessionPrincipal,
  ): Promise<Envelope<{ mailboxes: MailboxSummary[]; activeMailboxId: string | null }>> {
    const [mailboxes, userRow] = await Promise.all([
      this.mailboxes.listByWorkspace(user.workspaceId),
      this.users.findById(user.userId),
    ]);
    const prefs = (userRow?.preferences ?? {}) as { activeMailboxId?: unknown };
    const stored = typeof prefs.activeMailboxId === 'string' ? prefs.activeMailboxId : null;
    // Fall back to the first active mailbox if no preference is set,
    // or if the preferred mailbox is gone (disconnected/deleted).
    const activeMailboxId =
      stored && mailboxes.some((m) => m.id === stored && m.status === 'active')
        ? stored
        : (mailboxes.find((m) => m.status === 'active')?.id ?? null);
    return ok({ mailboxes, activeMailboxId });
  }

  @Delete(':id')
  @UseGuards(CsrfGuard)
  async disconnect(
    @CurrentUser() user: SessionPrincipal,
    @Param('id') id: string,
  ): Promise<Envelope<MailboxSummary>> {
    assertUuid(id);
    const summary = await this.mailboxes.disconnect({
      workspaceId: user.workspaceId,
      userId: user.userId,
      mailboxAccountId: id,
    });
    await this.clearActiveMailboxPreference(user, id);
    return ok(summary);
  }

  /**
   * Disconnect and schedule deletion of this mailbox's indexed Gmail
   * data. The durable worker performs the large purge asynchronously;
   * this 202 response confirms the Gmail credential is already removed
   * and the deletion request is persisted.
   */
  @Post(':id/indexed-data-deletion')
  @UseGuards(CsrfGuard)
  @RateLimit({ bucket: 'default', limit: 5, windowSec: 60 })
  @HttpCode(HttpStatus.ACCEPTED)
  async deleteIndexedData(
    @CurrentUser() user: SessionPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Envelope<MailboxDataDeletionReceipt>> {
    assertUuid(id);
    const parsed = MailboxDataDeletionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppException({
        code: 'BAD_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid indexed-data deletion request.',
      });
    }
    const receipt = await this.mailboxes.requestIndexedDataDeletion({
      workspaceId: user.workspaceId,
      userId: user.userId,
      mailboxAccountId: id,
      confirmPhrase: parsed.data.confirmPhrase,
    });
    await this.clearActiveMailboxPreference(user, id);
    return ok(receipt);
  }

  @Patch(':id/active')
  @UseGuards(CsrfGuard)
  async setActive(
    @CurrentUser() user: SessionPrincipal,
    @Param('id') id: string,
  ): Promise<Envelope<{ activeMailboxId: string }>> {
    // Ownership check: only set active to a mailbox in the user's workspace.
    const owned = await this.mailboxes.findOwned(user.workspaceId, id);
    if (!owned) {
      // Use a 404 — leaking "exists in another workspace" is a privacy leak.
      throw new (await import('@nestjs/common')).NotFoundException(
        'Mailbox not found in this workspace.',
      );
    }
    if (owned.status !== 'active') {
      throw new (await import('@nestjs/common')).BadRequestException(
        'Cannot set a disconnected mailbox as active.',
      );
    }
    await this.users.patchPreferences(user.userId, { activeMailboxId: id });
    return ok({ activeMailboxId: id });
  }

  /**
   * GET /api/mailboxes/:id/quiet-hours — the stored config (null until
   * first configured) + `activeNow` from the SAME predicate the
   * Autopilot action sweep defers on (U18 — D92/D93/D95).
   *
   * D19: deliberately NOT capability-gated — the /quiet screen renders
   * for every tier today (the D98 FE preview card isn't built), so an
   * under-tier session still needs this read to mount. The Pro value
   * (the config WRITE that makes Autopilot defer) is gated on the PUT.
   */
  @Get(':id/quiet-hours')
  async getQuietHours(
    @CurrentUser() user: SessionPrincipal,
    @Param('id') id: string,
  ): Promise<Envelope<QuietHoursState>> {
    assertUuid(id);
    const state = await this.mailboxes.getQuietHours(user.workspaceId, id);
    return ok(state);
  }

  /**
   * PUT /api/mailboxes/:id/quiet-hours — replace the quiet-hours
   * config. Body = `QuietHoursConfigSchema` (enabled + "HH:MM" local
   * start/end + IANA timezone; start ≠ end; cross-midnight windows
   * allowed via start > end). The write is a jsonb MERGE under the
   * `quiet_hours` key — sibling keys (`gmail_watch`, the manual quiet
   * toggle) survive (co-tenancy contract, see
   * packages/workers/src/quiet-hours-state.ts).
   *
   * D19/D98: quiet hours are a Pro capability — the WRITE 402s
   * `PRO_FEATURE_REQUIRED` for under-tier workspaces (the GET stays
   * open; see above).
   */
  @Put(':id/quiet-hours')
  @UseGuards(CsrfGuard, CapabilityGuard)
  @RequiresCapability('quiet')
  async putQuietHours(
    @CurrentUser() user: SessionPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Envelope<QuietHoursState>> {
    assertUuid(id);
    const parsed = QuietHoursConfigSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        'Body must be { enabled: boolean, startLocal: "HH:MM", endLocal: "HH:MM", timezone: IANA } with startLocal ≠ endLocal.',
      );
    }
    const state = await this.mailboxes.putQuietHours(user.workspaceId, id, parsed.data);
    return ok(state);
  }

  /** Clear only a preference that points at the mailbox being disconnected. */
  private async clearActiveMailboxPreference(user: SessionPrincipal, id: string): Promise<void> {
    const userRow = await this.users.findById(user.userId);
    const prefs = (userRow?.preferences ?? {}) as { activeMailboxId?: unknown };
    if (prefs.activeMailboxId === id) {
      await this.users.patchPreferences(user.userId, { activeMailboxId: null });
    }
  }
}

/** Reject non-UUID ids BEFORE the DB query — an invalid uuid cast 500s. */
function assertUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException('Mailbox id must be a UUID.');
  }
}
