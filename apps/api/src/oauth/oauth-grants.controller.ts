import {
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  UseGuards,
} from '@nestjs/common';

import type { ProductEventsPort } from '@declutrmail/shared/analytics/product-events';
import { ok, type ConnectedApps, type Envelope } from '@declutrmail/shared/contracts';

import { PRODUCT_EVENTS, recordProductEvent } from '../analytics/product-events.port.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { McpEnabledGuard, McpUserAllowedGuard } from '../mcp/mcp-enabled.guard.js';
import { SecurityEventsService } from '../security-events/security-events.service.js';
import { listConnectedGrants, revokeOwnedGrant } from './oauth-store.js';

/**
 * Settings → Connected apps (spec §4).
 *
 *   GET    /api/oauth/grants      — the apps that can act for this person.
 *   DELETE /api/oauth/grants/:id  — Disconnect: revoke the grant and
 *                                   every token under it.
 *
 * USER-scoped (JwtGuard only): a grant belongs to the person who
 * approved it, and this must work with zero connected Gmail accounts.
 */
@Controller('oauth/grants')
@UseGuards(McpEnabledGuard, JwtGuard, McpUserAllowedGuard)
export class OAuthGrantsController {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly securityEvents: SecurityEventsService,
    @Optional() @Inject(PRODUCT_EVENTS) private readonly productEvents?: ProductEventsPort,
  ) {}

  @Get()
  @RateLimit('default')
  async list(@CurrentUser() user: SessionPrincipal): Promise<Envelope<ConnectedApps>> {
    const grants = await listConnectedGrants(this.db, user.userId);
    return ok({
      apps: grants.map((grant) => ({
        id: grant.id,
        appName: grant.appName,
        redirectHosts: redirectHosts(grant.redirectUris),
        scopes: grant.scopes.filter(
          (scope): scope is 'read' | 'cleanup' => scope === 'read' || scope === 'cleanup',
        ),
        connectedAt: grant.createdAt.toISOString(),
        lastUsedAt: grant.lastUsedAt ? grant.lastUsedAt.toISOString() : null,
      })),
    });
  }

  @Delete(':id')
  @UseGuards(CsrfGuard)
  @RateLimit('default')
  async disconnect(
    @Param('id') id: string,
    @CurrentUser() user: SessionPrincipal,
  ): Promise<Envelope<{ id: string }>> {
    const outcome = await revokeOwnedGrant(this.db, user.userId, id);
    // Another person's grant is indistinguishable from one that never existed.
    if (outcome === 'not_found') throw new NotFoundException();
    if (outcome === 'revoked') {
      await this.securityEvents.record({
        eventType: 'connected_app.disconnected',
        severity: 'info',
        userId: user.userId,
        workspaceId: user.workspaceId,
        payload: { grantId: id },
      });
      recordProductEvent(this.productEvents, 'connector_app_disconnected', {}, user.userId);
    }
    return ok({ id });
  }
}

/**
 * The hosts an app sends people back to, as registered. The app's name
 * is whatever it called itself; these are what tell two apps with the
 * same name apart. A loopback redirect's port changes per run, so only
 * the hostname is shown.
 */
function redirectHosts(redirectUris: readonly string[]): string[] {
  const hosts = redirectUris.filter((uri) => URL.canParse(uri)).map((uri) => new URL(uri).hostname);
  return [...new Set(hosts)];
}
