import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import {
  type Envelope,
  ok,
  WaitlistV1JoinRequestSchema,
  type WaitlistV1JoinResult,
} from '@declutrmail/shared/contracts';

import { RateLimit } from '../common/rate-limit/index.js';
import { OptionalSessionGuard } from './optional-session.guard.js';
import { WaitlistService } from './waitlist.service.js';

/**
 * POST /api/v1/waitlist — Pro and provider capture.
 * Authenticated callers may omit email. Anonymous callers are rate-limited.
 * The body never distinguishes membership in a way the UI reveals, but the
 * status lets the client persist "joined" without a second round trip.
 */
@Controller('v1/waitlist')
export class WaitlistV1Controller {
  constructor(private readonly waitlist: WaitlistService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalSessionGuard)
  @RateLimit({ bucket: 'default', limit: 5, windowSec: 60 })
  async join(@Body() body: unknown, @Req() req: Request): Promise<Envelope<WaitlistV1JoinResult>> {
    const parsed = WaitlistV1JoinRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid waitlist request.',
      });
    }
    const status = await this.waitlist.joinLaunch(parsed.data, req.user?.userId);
    return ok({ status });
  }
}
