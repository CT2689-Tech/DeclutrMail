import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import type { ProductEventsPort } from '@declutrmail/shared/analytics/product-events';
import { ok, type ActionPreviewView, type Envelope } from '@declutrmail/shared/contracts';

import { PRODUCT_EVENTS, recordProductEvent } from '../analytics/product-events.port.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { AppException } from '../common/app-exception.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { ActionPreviewsService, type PreviewDetail } from './action-previews.service.js';
import { McpEnabledGuard, McpUserAllowedGuard } from './mcp-enabled.guard.js';
import { McpToolError } from './mcp-tool-errors.js';

const PREVIEW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The confirm page's API (ADR-0048 rule 1, spec §3).
 *
 *   GET  /api/action-previews/:id          — what an assistant asked for.
 *   POST /api/action-previews/:id/confirm  — the person pressed the verb.
 *
 * `confirm` is the ONLY way a preview leaves `pending`, and it sits on
 * the session cookie plus the CSRF token — credentials a bearer-token
 * MCP client does not hold. That separation is the whole guarantee: the
 * model can ask, only the person can say yes.
 *
 * USER-scoped (`JwtGuard`, no `CurrentMailboxGuard`): the preview names
 * its own mailbox, whichever one is active in the app.
 */
@Controller('action-previews')
@UseGuards(McpEnabledGuard, JwtGuard, McpUserAllowedGuard)
export class ActionPreviewsController {
  constructor(
    private readonly previews: ActionPreviewsService,
    @Optional() @Inject(PRODUCT_EVENTS) private readonly productEvents?: ProductEventsPort,
  ) {}

  @Get(':id')
  @RateLimit({ bucket: 'triage-load' })
  async get(
    @Param('id') id: string,
    @CurrentUser() user: SessionPrincipal,
  ): Promise<Envelope<ActionPreviewView>> {
    const detail = PREVIEW_ID.test(id) ? await this.previews.findOwned(id, user.userId) : null;
    if (!detail) throw new AppException({ code: 'PREVIEW_NOT_FOUND' });
    // The page was opened on a request still waiting for a press. A
    // refetch records it again: count distinct preview_id.
    if (detail.preview.state === 'pending' && !detail.expired) {
      recordProductEvent(
        this.productEvents,
        'connector_confirm_viewed',
        { verb: detail.preview.verb, preview_id: detail.preview.id },
        user.userId,
      );
    }
    return ok(await this.view(detail));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @RateLimit({ bucket: 'gmail-action' })
  async confirm(
    @Param('id') id: string,
    @CurrentUser() user: SessionPrincipal,
  ): Promise<Envelope<ActionPreviewView>> {
    if (!PREVIEW_ID.test(id)) throw new AppException({ code: 'PREVIEW_NOT_FOUND' });
    try {
      return ok(await this.view(await this.previews.confirm(id, user.userId)));
    } catch (error) {
      throw asHttpError(error);
    }
  }

  private async view(detail: PreviewDetail): Promise<ActionPreviewView> {
    const { preview } = detail;
    const result = preview.state === 'applied' ? preview.result : null;
    const [senderNames, skipped, actionStatus] = await Promise.all([
      this.previews.senderNames(preview),
      result
        ? this.previews.describeSkipped(preview, detail.mailboxEmail, result.skipped)
        : Promise.resolve([]),
      result ? this.previews.actionStatus(preview) : Promise.resolve(null),
    ]);
    return {
      id: preview.id,
      verb: preview.verb,
      alsoVerb: preview.alsoVerb,
      state: detail.expired ? 'expired' : preview.state,
      appName: detail.appName,
      mailboxEmail: detail.mailboxEmail,
      senderCount: preview.senderIds.length,
      emailCount: preview.emailCount,
      senderNames,
      olderThanDays: preview.olderThanDays,
      wakeAt: preview.wakeAt ? preview.wakeAt.toISOString() : null,
      expiresAt: preview.expiresAt.toISOString(),
      confirmedAt: preview.confirmedAt ? preview.confirmedAt.toISOString() : null,
      outcome: result
        ? {
            appliedSenders: result.appliedSenders,
            requestedEmails: result.requestedEmails,
            actionStatus,
            skipped,
          }
        : null,
    };
  }
}

/**
 * The previews service speaks in tool errors, because the tool is its
 * other caller. On this route they become registered HTTP codes; what an
 * action service threw (quota, tier, queue) passes through unchanged, so
 * the page shows what the app's own preview would.
 */
function asHttpError(error: unknown): unknown {
  if (!(error instanceof McpToolError)) return error;
  switch (error.code) {
    case 'PREVIEW_NOT_FOUND':
      return new AppException({ code: 'PREVIEW_NOT_FOUND' });
    case 'PREVIEW_EXPIRED':
      return new AppException({ code: 'PREVIEW_EXPIRED' });
    case 'MAILBOX_RECONNECT_REQUIRED':
      return new AppException({ code: 'PREVIEW_MAILBOX_DISCONNECTED' });
    default:
      return error;
  }
}
