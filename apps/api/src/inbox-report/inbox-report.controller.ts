import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';

import { ok, type Envelope } from '@declutrmail/shared/contracts';
import type { InboxReportDto, MailboxSnapshot } from '@declutrmail/shared/inbox-report';

import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { InboxReportService } from './inbox-report.service.js';

@Controller('mailboxes')
@UseGuards(JwtGuard)
export class InboxReportController {
  constructor(private readonly reports: InboxReportService) {}

  @Get(':id/inbox-snapshot')
  @RateLimit('triage-load')
  async snapshot(
    @CurrentUser() user: SessionPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Envelope<MailboxSnapshot>> {
    await this.reports.assertInWorkspace(user.workspaceId, id);
    return ok(await this.reports.getSnapshot(id));
  }

  @Get(':id/inbox-report')
  @RateLimit('triage-load')
  async get(
    @CurrentUser() user: SessionPrincipal,
    @Param('id') id: string,
  ): Promise<Envelope<InboxReportDto>> {
    await this.reports.assertInWorkspace(user.workspaceId, id);
    return ok(await this.reports.getForMailbox(id));
  }
}
