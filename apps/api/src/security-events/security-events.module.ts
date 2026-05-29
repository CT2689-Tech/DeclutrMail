import { Global, Module } from '@nestjs/common';

import { SecurityEventsService } from './security-events.service.js';

/**
 * SecurityEventsModule (D181).
 *
 * `@Global` so any feature that detects a security-relevant event can
 * inject {@link SecurityEventsService} without re-importing the module —
 * the same arrangement as DbModule. The service writes the
 * `security_events` audit log; producers (rate-limit breaches, login
 * attempts, webhook-signature failures, …) live in their own features
 * and call `record(...)`.
 */
@Global()
@Module({
  providers: [SecurityEventsService],
  exports: [SecurityEventsService],
})
export class SecurityEventsModule {}
