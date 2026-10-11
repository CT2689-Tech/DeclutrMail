import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { EMAIL_LINK_TEMPLATES } from '@declutrmail/shared/analytics/sanitize-product-event';
import type { ProductEventsPort } from '@declutrmail/shared/analytics/product-events';
import { type Envelope, ok } from '@declutrmail/shared/contracts';

import { RateLimit } from '../common/rate-limit/index.js';
import { OptionalSessionGuard } from './optional-session.guard.js';
import { PRODUCT_EVENTS, recordProductEvent } from './product-events.port.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EmailClickBodySchema = z
  .object({
    template: z.enum(EMAIL_LINK_TEMPLATES),
    mailboxId: z.string().regex(UUID).optional(),
  })
  .strict();

/**
 * POST /api/v1/analytics/email-click
 * Auth or anonymous. No CSRF, so a signed-out click still records.
 * Props are the template id and an optional mailbox id. Never an address.
 */
@Controller('v1/analytics')
export class EmailClickController {
  constructor(@Inject(PRODUCT_EVENTS) private readonly events: ProductEventsPort) {}

  @Post('email-click')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(OptionalSessionGuard)
  @RateLimit({ bucket: 'default', limit: 30, windowSec: 60 })
  recordClick(@Body() body: unknown, @Req() req: Request): Envelope<{ status: 'accepted' }> {
    const parsed = EmailClickBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Invalid email click.',
      });
    }
    const props: Record<string, string> = { template: parsed.data.template };
    if (parsed.data.mailboxId !== undefined) props.mailbox_id = parsed.data.mailboxId;
    const userId = req.user?.userId;
    if (userId === undefined) {
      recordProductEvent(this.events, 'email_link_clicked', props);
    } else {
      recordProductEvent(this.events, 'email_link_clicked', props, userId);
    }
    return ok({ status: 'accepted' });
  }
}
