import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { OAuthConsentController } from './oauth-consent.controller.js';
import { OAuthConsentService } from './oauth-consent.service.js';
import { OAuthGrantsController } from './oauth-grants.controller.js';
import { OAuthProtocolController } from './oauth-protocol.controller.js';
import { OAuthProviderService } from './oauth-provider.service.js';

/**
 * OAuthModule — DeclutrMail as an OAuth 2.1 authorization server for
 * the MCP connector (ADR-0048 rule 4, docs/spec/mcp-connector.md §4).
 *
 * Always loaded; every route 404s until `MCP_ENABLED=true`, and nothing
 * is constructed while it is off.
 *
 * Imports:
 *   - `AuthModule` — `JwtGuard` / `CsrfGuard`: consent and Connected
 *     apps run on the existing session, so there is one identity system.
 *   - `MailboxAccountsModule` — the consent page names the Gmail
 *     accounts an app would reach.
 *
 * `SecurityEventsModule`, `RateLimitModule` and `DbModule` are global.
 */
@Module({
  imports: [AuthModule, MailboxAccountsModule],
  controllers: [OAuthProtocolController, OAuthConsentController, OAuthGrantsController],
  providers: [OAuthProviderService, OAuthConsentService],
})
export class OAuthModule {}
