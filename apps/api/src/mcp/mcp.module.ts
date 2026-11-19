import { Module } from '@nestjs/common';

import { ActionsModule } from '../actions/actions.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EntitlementsModule } from '../common/entitlements/entitlements.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
import { SendersModule } from '../senders/senders.module.js';
import { SyncModule } from '../sync/sync.module.js';
import { UndoModule } from '../undo/undo.module.js';
import { ActionPreviewsController } from './action-previews.controller.js';
import { ActionPreviewsService } from './action-previews.service.js';
import { McpController } from './mcp.controller.js';
import { McpRateLimitGuard } from './mcp-rate-limit.guard.js';
import { McpServerService } from './mcp-server.service.js';
import { McpTokenGuard } from './mcp-token.guard.js';
import { McpToolsService } from './mcp-tools.service.js';

/**
 * McpModule — the connector (ADR-0048, docs/spec/mcp-connector.md).
 *
 *   `/mcp`                  the ten tools, behind a bearer token
 *   `/api/action-previews`  the confirm page's API, behind the session
 *
 * The connector is a second client of the action pipeline: it imports
 * the modules whose services the web app's own controllers call, and
 * adds no mail behavior. Always loaded; every route 404s while
 * `MCP_ENABLED` is off, and the MCP server is built on the first request.
 *
 * `RateLimitModule` and `DbModule` are global.
 */
@Module({
  imports: [
    ActionsModule,
    AuthModule,
    EntitlementsModule,
    MailboxAccountsModule,
    SendersModule,
    SyncModule,
    UndoModule,
  ],
  controllers: [McpController, ActionPreviewsController],
  providers: [
    ActionPreviewsService,
    McpRateLimitGuard,
    McpServerService,
    McpTokenGuard,
    McpToolsService,
  ],
})
export class McpModule {}
