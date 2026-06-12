// apps/api/src/waitlist/waitlist.controller.ts — HTTP surface for the
// D19 waitlist capture (pricing page Team row + marketing forms).
//
// Thin per D201/D204: validates against the shared Zod contract,
// delegates to `WaitlistService`, wraps in the D202 envelope.
//
// AUTH: NONE on purpose — this is a public marketing endpoint reached
// before any session exists. Compensating controls (D156): IP-keyed
// token bucket at 5/min (the interceptor keys on `req.user?.id ?? ip`,
// so anonymous callers are throttled per IP), plus the constant-202
// response below so the endpoint never leaks whether an email is
// already on the list.

import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import {
  type Envelope,
  ok,
  WaitlistJoinRequestSchema,
  type WaitlistJoinResult,
} from '@declutrmail/shared/contracts';

import { RateLimit } from '../common/rate-limit/index.js';
import { WaitlistService } from './waitlist.service.js';

@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  /**
   * POST /api/waitlist — capture {email, tierInterest?, source}.
   *
   * ALWAYS 202 with the same body for new and duplicate emails — a
   * duplicate must be indistinguishable so the form cannot be used to
   * probe who has signed up (no email-exists oracle). 400 only for
   * payloads that fail the shared contract.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ bucket: 'default', limit: 5, windowSec: 60 })
  async join(@Body() body: unknown): Promise<Envelope<WaitlistJoinResult>> {
    const parsed = WaitlistJoinRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid waitlist request.',
      });
    }
    await this.waitlist.join(parsed.data);
    return ok({ status: 'accepted' });
  }
}
