import type { IncomingMessage, ServerResponse } from 'node:http';

import { Inject, Injectable, Optional } from '@nestjs/common';
import { errors } from 'oidc-provider';

import type { ProductEventsPort } from '@declutrmail/shared/analytics/product-events';
import {
  ConnectorScopeSchema,
  type ConnectorConsent,
  type ConnectorConsentResult,
} from '@declutrmail/shared/contracts';

import { PRODUCT_EVENTS, recordProductEvent } from '../analytics/product-events.port.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { AppException } from '../common/app-exception.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import { mcpAllowedFor, mcpResourceUrl } from '../mcp/mcp-config.js';
import { SecurityEventsService } from '../security-events/security-events.service.js';
import { connectorClient } from './connector-client.js';
import { grantableScope, OAuthProviderService } from './oauth-provider.service.js';
import { createGrant, findLiveGrant, hasDeletionInFlight, revokeGrant } from './oauth-store.js';

/** A pending authorization request, read through the library's own cookie check. */
interface PendingRequest {
  clientId: string;
  redirectUri: string | undefined;
  scopes: string[];
  resource: string;
  /** The grant an earlier Approve on this same request already created. */
  approvedGrantId: string | undefined;
  returnTo: string;
}

/**
 * The consent step of the OAuth flow (ADR-0048 rule 4, spec §4).
 *
 * The authorization-server library parks the request and sends the
 * browser here; this service is the only place a person's decision is
 * recorded. Two things make that decision trustworthy:
 *
 *   - WHO decides is DeclutrMail's own session (`JwtGuard` on the
 *     controller), never a login the library remembers.
 *   - WHICH request is decided is bound to the browser that started it:
 *     `interactionDetails` reads the library's signed cookie, scoped to
 *     this request's path. A link to someone else's pending request
 *     cannot be approved from another browser.
 */
@Injectable()
export class OAuthConsentService {
  constructor(
    private readonly oauth: OAuthProviderService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly mailboxes: MailboxAccountsService,
    private readonly securityEvents: SecurityEventsService,
    @Optional() @Inject(PRODUCT_EVENTS) private readonly productEvents?: ProductEventsPort,
  ) {}

  /** What the consent page shows before the person decides. */
  async details(
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
    principal: SessionPrincipal,
  ): Promise<ConnectorConsent> {
    const pending = await this.load(req, res, requestId);
    const client = await this.oauth.provider.Client.find(pending.clientId);
    if (!client) throw new AppException({ code: 'CONNECT_REQUEST_GONE' });
    const redirectUri = pending.redirectUri ?? client.redirectUris?.[0];
    if (!redirectUri || !URL.canParse(redirectUri)) {
      throw new AppException({ code: 'CONNECT_REQUEST_GONE' });
    }
    const redirectHost = new URL(redirectUri).host;

    const mailboxes = await this.mailboxes.listByWorkspace(principal.workspaceId);
    return {
      appName: client.clientName ?? null,
      redirectHost,
      scopes: pending.scopes.map((scope) => ConnectorScopeSchema.parse(scope)),
      mailboxes: mailboxes.filter((m) => m.status === 'active').map((m) => m.email),
    };
  }

  /** Record Approve: create the grant, then let the library resume the request. */
  async approve(
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
    principal: SessionPrincipal,
  ): Promise<ConnectorConsentResult> {
    const pending = await this.load(req, res, requestId);
    // In beta, only the listed accounts can hand an assistant access.
    if (!mcpAllowedFor(principal.userId)) {
      throw new AppException({ code: 'CONNECT_NOT_AVAILABLE' });
    }
    // An account on its way out cannot hand an assistant new access (spec §7).
    if (await hasDeletionInFlight(this.db, principal.userId)) {
      throw new AppException({ code: 'CONNECT_DELETION_PENDING' });
    }

    // A second click on Approve reuses the first click's grant.
    if (pending.approvedGrantId) {
      const existing = await findLiveGrant(this.db, pending.approvedGrantId);
      if (existing?.userId === principal.userId && existing.clientId === pending.clientId) {
        return { redirectTo: pending.returnTo };
      }
    }

    let grantId: string;
    try {
      grantId = await createGrant(this.db, {
        workspaceId: principal.workspaceId,
        userId: principal.userId,
        clientId: pending.clientId,
        scopes: pending.scopes,
        resource: pending.resource,
      });
    } catch (error) {
      // The registration was removed while this request waited (an
      // unapproved client past retention): there is no app to return to.
      if (isForeignKeyViolation(error)) throw new AppException({ code: 'CONNECT_REQUEST_GONE' });
      throw error;
    }
    let redirectTo: string;
    try {
      redirectTo = await this.oauth.provider.interactionResult(
        req,
        res,
        // `remember: false` — the library keeps no login; see NoSessionStore.
        { login: { accountId: principal.userId, remember: false }, consent: { grantId } },
        { mergeWithLastSubmission: false },
      );
    } catch (error) {
      // The request vanished between the read and the write. Do not
      // leave a grant behind that no token will ever be issued under.
      await revokeGrant(this.db, grantId);
      throw this.asGone(error);
    }

    // An earlier connection to the same app is NOT retired here. It is
    // replaced when this approval's code is exchanged (see the storage
    // adapter): an approval that never completes must not cost the
    // person the connection they already have.
    await this.securityEvents.record({
      eventType: 'connected_app.connected',
      severity: 'info',
      userId: principal.userId,
      workspaceId: principal.workspaceId,
      payload: { grantId, clientId: pending.clientId, scopes: pending.scopes },
    });
    recordProductEvent(
      this.productEvents,
      'connector_app_connected',
      // The return address this request named; a client that named none
      // counts as "other" rather than costing the approval a lookup.
      { client: connectorClient(pending.redirectUri ? [pending.redirectUri] : []) },
      principal.userId,
    );
    return { redirectTo };
  }

  /** Record Deny: the library redirects back to the app with `access_denied`. */
  async deny(
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
    principal: SessionPrincipal,
  ): Promise<ConnectorConsentResult> {
    const pending = await this.load(req, res, requestId);
    let redirectTo: string;
    try {
      redirectTo = await this.oauth.provider.interactionResult(
        req,
        res,
        { error: 'access_denied', error_description: 'The request was denied.' },
        { mergeWithLastSubmission: false },
      );
    } catch (error) {
      throw this.asGone(error);
    }
    // Approve, then Deny, on the same request: the app is told
    // `access_denied`, so the approval's grant must not stay live. Only
    // the denier's own approval: someone else's is no longer reachable
    // (the request now carries the denial) and retention retires it.
    const approved = pending.approvedGrantId
      ? await findLiveGrant(this.db, pending.approvedGrantId)
      : undefined;
    if (approved?.userId === principal.userId) {
      const revoked = await revokeGrant(this.db, approved.id);
      if (revoked) {
        await this.securityEvents.record({
          eventType: 'connected_app.disconnected',
          severity: 'info',
          userId: revoked.userId,
          workspaceId: revoked.workspaceId,
          payload: { grantId: revoked.grantId, reason: 'denied' },
        });
      }
    }
    return { redirectTo };
  }

  private async load(
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
  ): Promise<PendingRequest> {
    let interaction;
    try {
      interaction = await this.oauth.provider.interactionDetails(req, res);
    } catch (error) {
      throw this.asGone(error);
    }
    const params = interaction.params;
    const clientId = params.client_id;
    const resource = params.resource;
    // The library validated the resource when it parked the request;
    // re-checking here keeps "one resource only" true at the write.
    if (
      interaction.uid !== requestId ||
      typeof clientId !== 'string' ||
      resource !== mcpResourceUrl()
    ) {
      throw new AppException({ code: 'CONNECT_REQUEST_GONE' });
    }
    return {
      clientId,
      redirectUri: typeof params.redirect_uri === 'string' ? params.redirect_uri : undefined,
      scopes: grantableScope(params.scope).split(' '),
      resource,
      approvedGrantId: interaction.result?.consent?.grantId,
      returnTo: interaction.returnTo,
    };
  }

  /** The library's "no such request for this browser" becomes our designed state. */
  private asGone(error: unknown): unknown {
    if (error instanceof errors.SessionNotFound) {
      return new AppException({ code: 'CONNECT_REQUEST_GONE' });
    }
    return error;
  }
}

/** Postgres foreign_key_violation (23503), whichever driver raised it. */
function isForeignKeyViolation(error: unknown): boolean {
  const code = (value: unknown) =>
    typeof value === 'object' && value !== null ? (value as { code?: unknown }).code : undefined;
  return code(error) === '23503' || code((error as { cause?: unknown } | null)?.cause) === '23503';
}
