import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { GoogleOAuthService } from './google-oauth.service.js';

/**
 * Gmail OAuth connect routes (D4). Thin per D201 — each handler calls
 * exactly one service method.
 *
 *   GET /api/auth/google/start    → 302 to the Google consent screen
 *   GET /api/auth/google/callback → exchange code, persist, JSON result
 */
@Controller('auth/google')
export class GoogleOAuthController {
  constructor(private readonly oauth: GoogleOAuthService) {}

  @Get('start')
  start(@Res() res: Response): void {
    res.redirect(302, this.oauth.getConsentUrl());
  }

  @Get('callback')
  async callback(
    @Query('code') code?: string,
  ): Promise<{ data: { mailboxAccountId: string; email: string; status: string } }> {
    if (!code) {
      throw new BadRequestException('Missing OAuth `code` query parameter.');
    }
    const result = await this.oauth.handleCallback(code);
    // D202 success envelope: { data: ... }.
    return {
      data: {
        mailboxAccountId: result.mailboxAccountId,
        email: result.email,
        status: 'connected',
      },
    };
  }
}
