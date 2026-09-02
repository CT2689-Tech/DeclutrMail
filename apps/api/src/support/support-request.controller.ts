import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import {
  ok,
  SupportRequestSchema,
  type Envelope,
  type SupportRequestResult,
} from '@declutrmail/shared/contracts';

import { AppException } from '../common/app-exception.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { SupportRequestService } from './support-request.service.js';

/**
 * SupportRequestController — `POST /api/support-request`.
 *
 * AUTH: `JwtGuard` only, deliberately no `CurrentMailboxGuard` — this
 * is account-scoped like `AccountController`'s deletion endpoints, not
 * mailbox-scoped. The mutation additionally takes `CsrfGuard` + a
 * tight rate limit (an authed endpoint that sends real outbound
 * email).
 */
@Controller('support-request')
@UseGuards(JwtGuard)
export class SupportRequestController {
  constructor(private readonly support: SupportRequestService) {}

  @Post()
  @UseGuards(CsrfGuard)
  @RateLimit({ bucket: 'default', limit: 5, windowSec: 300 })
  async submit(
    @CurrentUser() principal: SessionPrincipal,
    @Body() body: unknown,
  ): Promise<Envelope<SupportRequestResult>> {
    const parsed = SupportRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppException({
        code: 'BAD_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid support request.',
      });
    }
    return ok(await this.support.submit(principal, parsed.data));
  }
}
