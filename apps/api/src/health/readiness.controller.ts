import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { readApiPoolDiagnostics, type ApiPoolDiagnostics } from '../db/api-database.js';
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
async function probe(
  dependency: 'database' | 'redis',
  run: () => Promise<unknown>,
  poolDiagnostics?: () => ApiPoolDiagnostics | undefined,
): Promise<DependencyState> {
  const started = Date.now();
  const timeout = new Error('readiness probe timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeout), PROBE_TIMEOUT_MS);
      }),
    ]);
    return 'ok';
  } catch (error) {
    // Client error events do not report our local timeout. Preserve the
    // dependency and failure category here; never log raw provider errors,
    // which can contain connection details or credentials.
    const databasePool = poolDiagnostics?.();
    console.warn(
      JSON.stringify({
        level: 'warn',
        kind: 'readiness.dependency_failed',
        dependency,
        reason: error === timeout ? 'timeout' : 'error',
        durationMs: Date.now() - started,
        ...(databasePool ? { databasePool } : {}),
      }),
    );
    return 'down';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
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
      probe(
        'database',
        () => this.db.execute(sql`select 1`),
        () => readApiPoolDiagnostics(this.db),
      ),
      // A missing REDIS_URL is a legitimate posture outside production
      // (local dev, CI), so it reads as `not_configured` rather than
      // `down` — the app genuinely has no Redis to be down.
      this.redis === null
        ? Promise.resolve<DependencyState>('not_configured')
        : probe('redis', () => this.redis!.ping()),
    ]);

    // In PRODUCTION, `not_configured` is itself the fault: BullMQ has no
    // queue and the D156 limiter has no shared bucket store, so the
    // instance cannot serve even though nothing is technically "down".
    //
    // This endpoint must decide that ITSELF rather than lean on
    // RateLimitModule's "production refuses to boot without REDIS_URL"
    // guard — that guard is conditioned on `isProd && rateLimitEnabled`,
    // and the production deploy sets RATE_LIMIT_ENABLED=false, so it
    // never fires. Trusting it would make this endpoint answer 200 for
    // exactly the misconfiguration it exists to catch.
    const isProd = process.env.NODE_ENV === 'production';
    const redisOk = redis === 'ok' || (redis === 'not_configured' && !isProd);

    const body: ReadinessBody = {
      status: database === 'ok' && redisOk ? 'ok' : 'degraded',
      checks: { database, redis },
    };
    res.status(body.status === 'ok' ? 200 : 503).json(body);
  }
}
