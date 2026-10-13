import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  Query,
  UseGuards,
  BadRequestException,
  Header,
} from '@nestjs/common';
import { ok, type Envelope } from '@declutrmail/shared/contracts';
import {
  HomeVisitRequestSchema,
  type HomeVisitSummary,
} from '@declutrmail/shared/contracts/home-visit';
import { AuthModule } from '../auth/auth.module.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import { UsersModule } from '../users/users.module.js';
import { UsersService } from '../users/users.service.js';
import { SendersModule } from '../senders/senders.module.js';
import { SendersReadService } from '../senders/senders.read-service.js';
import { RateLimit } from '../common/rate-limit/index.js';

@Controller('home')
@UseGuards(JwtGuard, CurrentMailboxGuard, CsrfGuard)
export class HomeController {
  constructor(
    private readonly senders: SendersReadService,
    private readonly users: UsersService,
    private readonly mailboxes: MailboxAccountsService,
  ) {}

  @Get('visit')
  @Header('Cache-Control', 'private, no-store')
  @RateLimit('default')
  async peekVisit(
    @CurrentUser() user: SessionPrincipal,
    @CurrentMailbox() mailbox: { id: string },
    @Query('visitId') rawVisitId: string | undefined,
  ): Promise<Envelope<HomeVisitSummary>> {
    const visitId = parseOptionalVisitId(rawVisitId);
    const window = await this.users.peekMailboxVisit(
      user.userId,
      mailbox.id,
      visitId,
      (since, until, executor) => this.senders.indexedArrivals(mailbox.id, since, until, executor),
      (executor) => this.mailboxes.assertVisitEligible(user.userId, mailbox.id, executor),
    );
    return ok(window);
  }

  @Post('visit')
  @Header('Cache-Control', 'private, no-store')
  @RateLimit('default')
  async visit(
    @CurrentUser() user: SessionPrincipal,
    @CurrentMailbox() mailbox: { id: string },
    @Body() body: unknown,
  ): Promise<Envelope<HomeVisitSummary>> {
    const request = HomeVisitRequestSchema.safeParse(body);
    if (!request.success)
      throw new BadRequestException({ code: 'INVALID_REQUEST', message: 'Invalid visit.' });
    const window = await this.users.recordMailboxVisit(
      user.userId,
      mailbox.id,
      request.data.visitId,
      (since, until, executor) => this.senders.indexedArrivals(mailbox.id, since, until, executor),
      (executor) => this.mailboxes.assertVisitEligible(user.userId, mailbox.id, executor),
    );
    return ok(window);
  }
}

function parseOptionalVisitId(rawVisitId: string | undefined): string | undefined {
  if (rawVisitId === undefined || rawVisitId === '') return undefined;
  const parsed = HomeVisitRequestSchema.safeParse({ visitId: rawVisitId });
  if (!parsed.success)
    throw new BadRequestException({ code: 'INVALID_REQUEST', message: 'Invalid visit.' });
  return parsed.data.visitId;
}

@Module({
  imports: [AuthModule, MailboxAccountsModule, UsersModule, SendersModule],
  controllers: [HomeController],
})
export class HomeModule {}
