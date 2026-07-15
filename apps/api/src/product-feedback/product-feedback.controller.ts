import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';

import {
  ProductFeedbackRequestSchema,
  ok,
  type Envelope,
  type ProductFeedbackResult,
} from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { ProductFeedbackService } from './product-feedback.service.js';

@Controller('product-feedback')
@UseGuards(JwtGuard, CurrentMailboxGuard, CsrfGuard)
export class ProductFeedbackController {
  constructor(private readonly feedback: ProductFeedbackService) {}

  @Post()
  @RateLimit('default')
  async submit(
    @CurrentUser() principal: SessionPrincipal,
    @CurrentMailbox() mailbox: { id: string },
    @Body() body: unknown,
  ): Promise<Envelope<ProductFeedbackResult>> {
    const parsed = ProductFeedbackRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid product feedback.',
      });
    }
    return ok(await this.feedback.submit(principal, mailbox.id, parsed.data));
  }
}
