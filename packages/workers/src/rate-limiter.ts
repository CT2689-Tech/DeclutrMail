/**
 * Sliding-window rate limiter (D5 — Gmail API throttle).
 *
 * Gmail enforces a per-user quota: 15,000 quota units / user / minute
 * (`messages.get` and `messages.list` each cost 5 units). A backfill that
 * bursts past that gets 403 "Quota exceeded" and — without this limiter
 * — fails. This caps consumption to `maxUnits` per `windowMs`, pacing
 * the worker under the ceiling.
 *
 * One limiter instance gates one mailbox's sync (the quota is per-user,
 * and `perMailboxPolicy` runs one job per mailbox).
 */

/** Injectable clock + delay — defaults are real; tests override both. */
export interface RateLimiterClock {
  /** Current time, ms. */
  now?: () => number;
  /** Delay `ms` before resolving. */
  sleep?: (ms: number) => Promise<void>;
}

export class RateLimiter {
  /** Timestamps + unit cost of recent acquisitions, oldest first. */
  private readonly events: { at: number; units: number }[] = [];
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  /**
   * @param maxUnits  Max units allowed within any `windowMs` span.
   * @param windowMs  The sliding window, ms.
   * @param clock     Injectable now/sleep — overridden in tests.
   */
  constructor(
    private readonly maxUnits: number,
    private readonly windowMs: number,
    clock: RateLimiterClock = {},
  ) {
    this.now = clock.now ?? Date.now;
    this.sleep = clock.sleep ?? defaultSleep;
  }

  /**
   * Block until `units` can be spent without breaching the window, then
   * record the spend.
   */
  async acquire(units: number): Promise<void> {
    for (;;) {
      const waitMs = this.reserve(units, this.now());
      if (waitMs === 0) {
        return;
      }
      await this.sleep(waitMs);
    }
  }

  /**
   * Pure window check. Prunes expired events; if `units` fits, records
   * the spend and returns 0. Otherwise returns ms to wait for the oldest
   * event to age out. Exposed for deterministic testing.
   */
  reserve(units: number, now: number): number {
    while (this.events.length > 0 && now - this.events[0]!.at >= this.windowMs) {
      this.events.shift();
    }
    const used = this.events.reduce((sum, e) => sum + e.units, 0);
    if (used + units <= this.maxUnits) {
      this.events.push({ at: now, units });
      return 0;
    }
    // Wait for the oldest event to leave the window (+1ms guard).
    return this.windowMs - (now - this.events[0]!.at) + 1;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
