import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { READINESS_REDIS } from './readiness-redis.provider.js';

/** How long a single dependency probe may take before it counts as down. */
const PROBE_TIMEOUT_MS = 2000;

type DependencyState = 'ok' | 'down' | 'not_configured';

interface ReadinessBody {
  status: 'ok' | 'degraded';
  checks: { database: DependencyState; redis: DependencyState };
}

/**
 * Bound a dependency probe so a HUNG connection reads as `down` rather
 * than hanging the probe itself. A readiness endpoint that never answers
 * is indistinguishable from a healthy one to an uptime check that only
 * watches for non-200s — it just times out and reports nothing useful.
 */
async function probe(run: () => Promise<unknown>): Promise<DependencyState> {
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS)),
    ]);
    return 'ok';
  } catch {
    // Deliberately swallowed: the CAUSE goes to logs/Sentry through the
    // failing client's own error path, never into this response body.
    // Provider errors are quotable — Upstash's suspension reply names the
    // vendor and the billing state — and this endpoint is unauthenticated.
    return 'down';
  }
}

/**
 * Dependency-readiness endpoint, deliberately SEPARATE from `/healthz`.
 *
 * `/healthz` is liveness: dependency-free, so a transient Postgres or
 * Redis blip cannot turn into a Cloud Run restart loop. That property is
 * worth keeping — but it also means `/healthz` answered 200 throughout a
 * 46-day Upstash suspension (7,922 Sentry errors, first seen 2026-06-09),
 * because process liveness was never the thing that broke. The uptime
 * check watching it could not fire, so nothing did.
 *
 * This endpoint answers the other question — "can this instance actually
 * serve?" — and returns 503 when it cannot, which is what makes an uptime
 * check alert. Point Cloud Monitoring at THIS path for outage detection;
 * leave the Cloud Run container probe on `/healthz`.
 *
 * Redis is not optional in production: BullMQ carries every sync and
 * mail-mutating job, and the D156 limiter's token buckets live there. A
 * process that cannot reach it is up but useless.
 */
@Controller('readyz')
export class ReadinessController {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(READINESS_REDIS) private readonly redis: Redis | null,
  ) {}

  @Get()
  async getReadiness(@Res() res: Response): Promise<void> {
    const [database, redis] = await Promise.all([
      probe(() => this.db.execute(sql`select 1`)),
      // A missing REDIS_URL is a real posture outside production (local
      // dev, CI), so it reads as `not_configured` rather than `down` —
      // but production refuses to boot without it (see RateLimitModule),
      // so this branch cannot mask a prod outage.
      this.redis === null
        ? Promise.resolve<DependencyState>('not_configured')
        : probe(() => this.redis!.ping()),
    ]);

    const body: ReadinessBody = {
      status: database === 'ok' && redis !== 'down' ? 'ok' : 'degraded',
      checks: { database, redis },
    };
    res.status(body.status === 'ok' ? 200 : 503).json(body);
  }
}
