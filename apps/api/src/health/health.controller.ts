import { Controller, Get } from '@nestjs/common';

/**
 * Process-liveness endpoint for Cloud Run and external uptime monitors.
 *
 * Keep this dependency-free: readiness of Postgres, Redis, and Gmail is
 * observed through their own alerts. Coupling those dependencies to liveness
 * would turn a transient outage into a restart loop and make diagnosis harder.
 */
@Controller('healthz')
export class HealthController {
  @Get()
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
