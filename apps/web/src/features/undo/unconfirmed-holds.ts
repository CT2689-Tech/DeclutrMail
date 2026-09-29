import { useCallback, useEffect, useRef, useState } from 'react';

import { isRunning, useInFlightActions } from './in-flight';

/** How often the in-flight list is re-read while any row is held. */
export const HOLD_RECHECK_MS = 5_000;

/**
 * How long the in-flight list must stay quiet: first after the latest hold,
 * so a job whose request answered 5xx before it committed can show up, then
 * again between two reads.
 */
export const HOLD_SETTLE_MS = 10_000;

export interface UnconfirmedHold<V extends string> {
  /** The verb whose outcome is unknown, for "<Verb>: unknown". */
  readonly verb: V;
  readonly at: number;
}

const NO_HOLDS: ReadonlyMap<string, never> = new Map<string, never>();

/**
 * Rows whose job may be running although the screen could not confirm it: a
 * 5xx on enqueue, or a lost status read. A second dispatch could run the job
 * twice, so a held row refuses one until:
 *   - a list read no longer shows it — its job landed; or
 *   - the in-flight list, read twice after the latest hold and
 *     `HOLD_SETTLE_MS` apart, shows nothing running for the mailbox —
 *     nothing is left that could land.
 * The screen calls `reset` when the mailbox changes.
 */
export function useUnconfirmedHolds<V extends string>(
  mailboxId: string | undefined,
  /** Ids the screen's latest list read shows; `null` before one exists. */
  listedIds: readonly string[] | null,
) {
  const [held, setHeld] = useState<ReadonlyMap<string, UnconfirmedHold<V>>>(NO_HOLDS);
  const inFlight = useInFlightActions(mailboxId);

  const hold = useCallback((ids: readonly string[], verb: V) => {
    if (ids.length === 0) return;
    const at = Date.now();
    setHeld((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.set(id, { verb, at });
      return next;
    });
  }, []);
  const reset = useCallback(() => setHeld(NO_HOLDS), []);

  useEffect(() => {
    if (listedIds === null) return;
    setHeld((prev) => {
      if (prev.size === 0) return prev;
      const listed = new Set(listedIds);
      const next = new Map([...prev].filter(([id]) => listed.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [listedIds]);

  // The in-flight query polls only while it sees work running, so a hold
  // whose job never started would never be read again without this.
  const holding = held.size > 0;
  const { refetch, data, dataUpdatedAt, status } = inFlight;
  useEffect(() => {
    if (!holding) return;
    const timer = setInterval(() => void refetch(), HOLD_RECHECK_MS);
    return () => clearInterval(timer);
  }, [holding, refetch]);

  const quietSince = useRef<number | null>(null);
  useEffect(() => {
    if (held.size === 0) {
      quietSince.current = null;
      return;
    }
    if (status !== 'success' || data === undefined) return;
    const settledAfter = Math.max(...[...held.values()].map((h) => h.at)) + HOLD_SETTLE_MS;
    if (dataUpdatedAt < settledAfter) return;
    if (data.some(isRunning)) {
      quietSince.current = null;
      return;
    }
    if (quietSince.current === null || quietSince.current < settledAfter) {
      quietSince.current = dataUpdatedAt;
      return;
    }
    if (dataUpdatedAt - quietSince.current >= HOLD_SETTLE_MS) {
      quietSince.current = null;
      setHeld(NO_HOLDS);
    }
  }, [held, data, dataUpdatedAt, status]);

  return { held, hold, reset };
}
