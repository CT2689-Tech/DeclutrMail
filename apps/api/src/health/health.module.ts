import { WorkerReadinessController } from './worker-readiness.controller.js';
import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { ReadinessController } from './readiness.controller.js';
import { READINESS_REDIS_PROVIDER } from './readiness-redis.provider.js';

/**
 * Two endpoints answering two different questions: `/healthz` is
 * liveness (dependency-free, drives the container probe) and `/readyz`
 * is dependency readiness (503s on a real outage, drives alerting).
 */
@Module({
  controllers: [HealthController, ReadinessController, WorkerReadinessController],
  providers: [READINESS_REDIS_PROVIDER],
})
export class HealthModule {}
