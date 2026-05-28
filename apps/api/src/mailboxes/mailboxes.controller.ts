import { Controller, Delete, Get, Param, Patch, UseGuards } from '@nestjs/common';

import { ok, type Envelope } from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { UsersService } from '../users/users.service.js';
import { MailboxAccountsService, type MailboxSummary } from './mailbox-accounts.service.js';

/**
 * Mailboxes routes (D205 MailboxAccountsModule).
 *
 *   GET    /api/mailboxes              → list workspace mailboxes
 *   DELETE /api/mailboxes/:id          → disconnect (revoke + nullify)
 *   PATCH  /api/mailboxes/:id/active   → set as the user's active mailbox
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
    const summary = await this.mailboxes.disconnect({
      workspaceId: user.workspaceId,
      mailboxAccountId: id,
    });
    // If the disconnected mailbox was the active one, clear the
    // preference so the next request resolves a different mailbox.
    const userRow = await this.users.findById(user.userId);
    const prefs = (userRow?.preferences ?? {}) as { activeMailboxId?: unknown };
    if (prefs.activeMailboxId === id) {
      await this.users.patchPreferences(user.userId, { activeMailboxId: null });
    }
    return ok(summary);
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
}
