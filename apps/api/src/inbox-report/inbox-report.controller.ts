import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';

import { ok, type Envelope } from '@declutrmail/shared/contracts';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { InboxReportService, isInboxReportEnabled } from './inbox-report.service.js';

@Controller('mailboxes')
@UseGuards(JwtGuard)
export class InboxReportController {
  constructor(private readonly reports: InboxReportService) {}

  @Get(':id/inbox-report')
  async get(
    @CurrentUser() user: SessionPrincipal,
    @Param('id') id: string,
  ): Promise<Envelope<InboxReportDto>> {
    if (!isInboxReportEnabled()) throw new NotFoundException();
    await this.reports.assertInWorkspace(user.workspaceId, id);
    return ok(await this.reports.getForMailbox(id));
  }
}
