import { Logger, type Provider } from '@nestjs/common';
import { Redis } from 'ioredis';

/** DI token for the readiness probe's dedicated Redis client. */
export const READINESS_REDIS = 'READINESS_REDIS';

const bootLogger = new Logger('ReadinessRedis');

/**
 * A dedicated client for the readiness probe, for the same reason the
 * rate limiter keeps its own: BullMQ's connection requires
 * `maxRetriesPerRequest: null`, which would make a probe against a
 * suspended Redis retry forever instead of answering "down".
 *
 * `enableOfflineQueue: false` makes a command issued while disconnected
 * reject immediately rather than queue behind a reconnect — that
 * rejection IS the signal. Deliberately NOT `lazyConnect`: combined with
 * the disabled offline queue it never connects at all, because nothing
 * triggers the connect and every ping rejects first. A live probe
 * against healthy Redis reported "down" until this was removed; the unit
 * tests could not see it, since they mock `ping` and so skip the
 * connection entirely.
 *
 * Connecting eagerly does not couple boot to Redis: ioredis retries in
 * the background, and the `error` handler below keeps an unreachable
 * server from taking the process down. The probe just reports `down`
 * until it comes back.
 *
 * Null when `REDIS_URL` is unset (local dev / CI); the controller
 * reports that as `not_configured`.
 */
export const READINESS_REDIS_PROVIDER: Provider = {
  provide: READINESS_REDIS,
  useFactory: (): Redis | null => {
    const url = process.env.REDIS_URL;
    if (!url) return null;
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // ioredis emits 'error' per reconnect attempt; an unhandled one takes
    // the process down, which would turn "Redis is unreachable" into
    // exactly the crash loop /healthz exists to avoid.
    client.on('error', (err) => bootLogger.error(`readiness redis: ${err.message}`));
    return client;
  },
};
