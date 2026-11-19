import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  ok,
  type ConnectorConsent,
  type ConnectorConsentResult,
  type Envelope,
} from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { webUrl } from '../mcp/mcp-config.js';
import { McpEnabledGuard } from '../mcp/mcp-enabled.guard.js';
import { OAuthConsentService } from './oauth-consent.service.js';

/** The library's request ids are URL-safe random strings. */
const REQUEST_ID = /^[A-Za-z0-9_-]{16,64}$/;

function assertRequestId(id: string): string {
  if (!REQUEST_ID.test(id)) throw new NotFoundException();
  return id;
}

/**
 * Consent API for the web consent page (spec §4).
 *
 *   GET  /api/oauth/interactions/:id          — the library sends the
 *        browser here; we send it on to the consent page. This hop is
 *        what scopes the library's request cookie to the routes below.
 *   GET  /api/oauth/interactions/:id/details  — what the page shows.
 *   POST /api/oauth/interactions/:id/approve  — the person said yes.
 *   POST /api/oauth/interactions/:id/deny     — the person said no.
 *
 * The decision routes use the existing session: `JwtGuard` + `CsrfGuard`,
 * exactly like every other cookie route. A signed-out visitor gets the
 * usual 401 and the web client sends them through Google sign-in and
 * back.
 */
@Controller('oauth/interactions')
@UseGuards(McpEnabledGuard)
export class OAuthConsentController {
  constructor(private readonly consent: OAuthConsentService) {}

  @Get(':id')
  @RateLimit('default')
  start(@Param('id') id: string, @Res() res: Response): void {
    const query = new URLSearchParams({ request: assertRequestId(id) });
    res.redirect(303, `${webUrl()}/connect/authorize?${query.toString()}`);
  }

  @Get(':id/details')
  @UseGuards(JwtGuard)
  @RateLimit('default')
  async details(
    @Param('id') id: string,
    @CurrentUser() user: SessionPrincipal,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Envelope<ConnectorConsent>> {
    return ok(await this.consent.details(req, res, assertRequestId(id), user));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @UseGuards(JwtGuard, CsrfGuard)
  @RateLimit('default')
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: SessionPrincipal,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Envelope<ConnectorConsentResult>> {
    return ok(await this.consent.approve(req, res, assertRequestId(id), user));
  }

  @Post(':id/deny')
  @HttpCode(200)
  @UseGuards(JwtGuard, CsrfGuard)
  @RateLimit('default')
  async deny(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: SessionPrincipal,
  ): Promise<Envelope<ConnectorConsentResult>> {
    return ok(await this.consent.deny(req, res, assertRequestId(id), user));
  }
}
