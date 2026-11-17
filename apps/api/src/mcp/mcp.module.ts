import { Module } from '@nestjs/common';

import { McpController } from './mcp.controller.js';
import { McpTokenGuard } from './mcp-token.guard.js';

/**
 * McpModule — the `/mcp` resource server (ADR-0048).
 *
 * PR 1 of spec §10 lands the bearer-token guard and the guarded route;
 * PR 2 adds the transport and the tools here. Always loaded; 404 until
 * `MCP_ENABLED=true`.
 */
@Module({
  controllers: [McpController],
  providers: [McpTokenGuard],
  exports: [McpTokenGuard],
})
export class McpModule {}
