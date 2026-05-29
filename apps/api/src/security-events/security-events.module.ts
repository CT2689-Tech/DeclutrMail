import { forwardRef, Global, Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminAllowlistGuard } from './admin-allowlist.guard.js';
import { SecurityEventsController } from './security-events.controller.js';
import { SecurityEventsReadService } from './security-events-read.service.js';
import { SecurityEventsService } from './security-events.service.js';

/**
 * SecurityEventsModule (D181).
 *
 * Write surface: `@Global` provides {@link SecurityEventsService} so any
 * feature that detects a security-relevant event can inject it without
 * re-importing the module — the same arrangement as DbModule. The
 * service writes the `security_events` audit log; producers
 * (rate-limit breaches, login attempts, webhook-signature failures, …)
 * live in their own features and call `record(...)`.
 *
 * Read surface: {@link SecurityEventsController} exposes the operator
 * read API at `GET /api/security-events`, gated by
 * {@link AdminAllowlistGuard} (founder-only via `ADMIN_EMAIL_ALLOWLIST`).
 * The controller imports `AuthModule` (for `JwtGuard`) and
 * `UsersModule` (so the allowlist guard can resolve the session's
 * email). `forwardRef` on AuthModule because AuthModule transitively
 * depends on this @Global module via the write surface.
 */
@Global()
@Module({
  imports: [UsersModule, forwardRef(() => AuthModule)],
  controllers: [SecurityEventsController],
  providers: [SecurityEventsService, SecurityEventsReadService, AdminAllowlistGuard],
  exports: [SecurityEventsService],
})
export class SecurityEventsModule {}
