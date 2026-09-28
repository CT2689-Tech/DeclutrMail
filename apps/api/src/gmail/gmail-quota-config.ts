import {
  parseGmailQuotaMetric,
  quotaUnitsFor,
  type GmailQuotaMetric,
} from './gmail-client.service.js';

/** The sustained budget's window: Gmail's per-user limits are per minute. */
export const GMAIL_QUOTA_WINDOW_MS = 60_000;

/**
 * Burst window — separate from the sustained target (2026-09-03,
 * post-incident: see `RedisGmailQuotaLimiter`'s class doc for the full
 * root-cause). Both limiter implementations previously started a fresh
 * mailbox's bucket FULL, so `InitialSyncWorker`'s fetch loop could spend
 * the entire sustained budget the instant it started, with zero pacing
 * before either limiter ever introduced a delay.
 *
 * A five-second share of the sustained budget caps that instant burst:
 * 400 units by default or 1,000 for the production legacy quota. Paired
 * with this window at the SAME average rate, so the in-process
 * `RateLimiter` fallback paces identically to the primary Redis-backed
 * bucket instead of reverting to the old full-burst behavior the moment
 * Redis degrades.
 */
export const GMAIL_QUOTA_BURST_WINDOW_MS = 5_000;

/** How a worker paces Gmail for one mailbox — logged once at boot. */
export interface GmailQuotaConfig {
  /** The Google quota metric the budget below is measured on. */
  metric: GmailQuotaMetric;
  /** Sustained units per mailbox per minute. */
  unitsPerMin: number;
  /** Units a fresh bucket may spend in one burst window. */
  burstCapacity: number;
  /** Units one `messages.get` draws on `metric` — what sets first-sync pace. */
  messagesGetUnits: number;
}

/**
 * Resolve the Gmail quota throttle (D5) from env. Called inside the
 * worker's `bootstrap()` so a bad value fails through `worker.boot_failed`
 * rather than as a bare module-load stack trace.
 *
 * `GMAIL_QUOTA_UNITS_PER_MIN`: newer projects get 6,000 units/user/minute,
 * so unset defaults to 4,800 (20% headroom). The production project keeps
 * a 15,000-unit legacy limit, so its deploy manifest sets 12,000.
 *
 * `GMAIL_QUOTA_METRIC` names the metric that budget is measured on, which
 * decides what each method costs (see `GmailQuotaMetric`). Budget and
 * prices from different metrics is the 2026-09-24 (UTC) regression: a 12,000
 * budget priced at the newer metric's 20 units per read ran first syncs
 * at a quarter of their real pace.
 */
export function resolveGmailQuotaConfig(env: NodeJS.ProcessEnv): GmailQuotaConfig {
  const metric = parseGmailQuotaMetric(env.GMAIL_QUOTA_METRIC);
  const configured = env.GMAIL_QUOTA_UNITS_PER_MIN;
  const unitsPerMin = configured ? Number(configured) : 4_800;
  if (!Number.isSafeInteger(unitsPerMin) || unitsPerMin < 1_200 || unitsPerMin > 12_000) {
    throw new Error('GMAIL_QUOTA_UNITS_PER_MIN must be an integer from 1200 to 12000');
  }
  return {
    metric,
    unitsPerMin,
    burstCapacity: Math.floor(unitsPerMin / 12),
    messagesGetUnits: quotaUnitsFor(metric).messagesGet,
  };
}
