import { OPERATIONAL_INTERVAL_MS } from './operational-telemetry.js';

/** A completed database write, rather than a live timer, proves worker liveness. */
export class WorkerHealth {
  private heartbeatInFlight: Promise<void> | undefined;
  private collectionInFlight: Promise<void> | undefined;
  private lastCollectionAt = -Infinity;
  private lastHeartbeatAt: number | undefined;

  constructor(
    private readonly heartbeat: () => Promise<void>,
    private readonly collect: () => Promise<void>,
    private readonly failed: (kind: 'worker.heartbeat_failed' | 'worker.collection_failed') => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  isFresh(): boolean {
    return this.lastHeartbeatAt !== undefined && this.now() - this.lastHeartbeatAt <= 180_000;
  }

  tick(): void {
    // A pending heartbeat must not prevent independent telemetry from reporting.
    if (!this.collectionInFlight && this.now() - this.lastCollectionAt >= OPERATIONAL_INTERVAL_MS) {
      this.lastCollectionAt = this.now();
      this.collectionInFlight = Promise.resolve()
        .then(this.collect)
        .catch(() => this.failed('worker.collection_failed'))
        .finally(() => {
          this.collectionInFlight = undefined;
        });
    }
    if (this.heartbeatInFlight) return;
    this.heartbeatInFlight = Promise.resolve()
      .then(this.heartbeat)
      .then(() => {
        this.lastHeartbeatAt = this.now();
      })
      .catch(() => this.failed('worker.heartbeat_failed'))
      .finally(() => {
        this.heartbeatInFlight = undefined;
      });
  }

  async drain(): Promise<void> {
    await Promise.all([this.heartbeatInFlight, this.collectionInFlight]);
  }
}

/** One response contract shared by startup and ongoing Cloud Run probes. */
export function workerHealthResponse(
  bootstrapComplete: boolean,
  admissionHeld: boolean,
  fresh: boolean,
) {
  const healthy = admissionHeld || (bootstrapComplete && fresh);
  return {
    statusCode: healthy ? 200 : 503,
    body: admissionHeld
      ? 'admission-held'
      : healthy
        ? 'ok'
        : bootstrapComplete
          ? 'degraded'
          : 'starting',
  };
}
